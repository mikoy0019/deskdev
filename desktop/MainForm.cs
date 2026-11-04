using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace DeskDev.Desktop;

/// <summary>
/// The DeskDev window: the web app in WebView2, with its own profile (stays
/// signed in, separate from the browser), links to anywhere else opened in
/// the default browser, and a banner when a newer installer is published.
/// </summary>
internal sealed class MainForm : Form
{
    /// <summary>%LOCALAPPDATA%\DeskDev — the WebView2 profile and the window position.</summary>
    private static readonly string DataDir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeskDev");

    /// <summary>Microsoft's Evergreen WebView2 Runtime bootstrapper.</summary>
    private const string RuntimeDownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    private readonly AppConfig _config;
    /// <summary>Which of the configured addresses answered; set before the first navigation.</summary>
    private AppAddress _address = null!;
    private readonly WebView2 _web;
    private readonly UpdateBar _updateBar;
    private readonly TaskbarBadge _badge;
    private readonly bool _dark = WindowsUsesDarkTheme();

    public static Version CurrentVersion { get; } = Normalize(Assembly.GetExecutingAssembly().GetName().Version);

    public MainForm(AppConfig config)
    {
        _config = config;
        Text = "DeskDev";
        Icon = LoadIcon();
        MinimumSize = new Size(820, 560);
        BackColor = _dark ? Color.FromArgb(10, 12, 18) : Color.White;
        WindowPlacement.Restore(this, DataDir);

        _web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        _updateBar = new UpdateBar(OpenExternal) { Dock = DockStyle.Top, Visible = false };
        Controls.Add(_web);
        Controls.Add(_updateBar);
        _badge = new TaskbarBadge(this);

        Load += async (_, _) => await StartAsync();
        HandleCreated += (_, _) => UseDarkTitleBar(Handle, _dark);
        FormClosing += (_, _) => WindowPlacement.Save(this, DataDir);
        FormClosed += (_, _) => _badge.Dispose();
    }

    /// <summary>A second launch of DeskDev brings this window back instead.</summary>
    public void ShowFromSecondLaunch()
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show();
        Activate();
    }

    private async Task StartAsync()
    {
        // Asked while WebView2 starts; both take about a second.
        var resolving = _config.ResolveAsync();
        try
        {
            Directory.CreateDirectory(DataDir);
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataDir, "WebView2"));
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            var open = MessageBox.Show(
                this,
                "DeskDev needs the Microsoft Edge WebView2 Runtime, which is missing on this PC.\n\nOpen Microsoft's download page now?",
                "DeskDev",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Information);
            if (open == DialogResult.Yes) OpenExternal(new Uri(RuntimeDownloadUrl));
            Close();
            return;
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"DeskDev could not start:\n\n{ex.Message}", "DeskDev", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        _address = await resolving;
        var core = _web.CoreWebView2;
        var settings = core.Settings;
        // The web app reads this to know it runs here (Settings → Desktop app).
        settings.UserAgent = $"{settings.UserAgent} DeskDevDesktop/{CurrentVersion.ToString(3)}";
        settings.AreDevToolsEnabled = _config.DevTools;
        settings.IsStatusBarEnabled = false;
        settings.IsPasswordAutosaveEnabled = true;
        settings.IsGeneralAutofillEnabled = true;

        core.DocumentTitleChanged += (_, _) =>
            Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? "DeskDev" : core.DocumentTitle;
        core.NavigationStarting += OnNavigationStarting;
        core.NewWindowRequested += OnNewWindowRequested;
        core.NavigationCompleted += OnNavigationCompleted;
        core.PermissionRequested += OnPermissionRequested;
        core.ProcessFailed += OnProcessFailed;
        core.WebMessageReceived += OnWebMessageReceived;

        core.Navigate(_address.StartUrl.AbsoluteUri);
        _ = CheckForUpdateAsync();
    }

    // ─── Where links go ─────────────────────────────────────────────────────

    private bool IsInApp(Uri uri) =>
        string.Equals(uri.GetLeftPart(UriPartial.Authority), _address.Origin, StringComparison.OrdinalIgnoreCase);

    private static bool IsLocalDocument(Uri uri) => uri.Scheme is "about" or "data" or "blob";

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;
        if (IsInApp(uri) || IsLocalDocument(uri)) return;
        // Everything else — the public site, Google sign-in, a client's
        // website — opens in the default browser. (Google also refuses to
        // sign in inside embedded browsers.)
        e.Cancel = true;
        OpenExternal(uri);
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;
        // blob:/data: popups (an exported file, a print view) keep WebView2's own window.
        if (IsLocalDocument(uri)) return;
        e.Handled = true;
        if (IsInApp(uri)) _web.CoreWebView2.Navigate(uri.AbsoluteUri);
        else OpenExternal(uri);
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess) return;
        // Our own cancels (a link sent to the browser) are not failures.
        if (e.WebErrorStatus is CoreWebView2WebErrorStatus.OperationCanceled or CoreWebView2WebErrorStatus.ConnectionAborted) return;
        _web.CoreWebView2.NavigateToString(OfflinePage.Html(_address.StartUrl, _dark));
    }

    private void OnPermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        // Desktop notifications for DeskDev itself without a second prompt;
        // anything else (camera, microphone…) gets WebView2's normal question.
        if (e.PermissionKind == CoreWebView2PermissionKind.Notifications
            && Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && IsInApp(uri))
        {
            e.State = CoreWebView2PermissionState.Allow;
        }
    }

    private void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
        {
            Application.Restart();
            Close();
        }
        else if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited
                 or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
        {
            _web.CoreWebView2?.Reload();
        }
    }

    /// <summary>
    /// {type:'deskdev:badge', count} from the web app (pwa/useAppBadge.ts):
    /// the unread count for the taskbar button. Only DeskDev's own pages may
    /// set it; anything else is ignored.
    /// </summary>
    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || !IsInApp(source)) return;
        try
        {
            var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
            if (data == null || !data.TryGetValue("type", out var type) || type as string != "deskdev:badge") return;
            if (!data.TryGetValue("count", out var raw)) return;
            var count = Convert.ToInt32(raw, System.Globalization.CultureInfo.InvariantCulture);
            _badge.Set(count);
        }
        catch (Exception)
        {
            // Not JSON we know: ignore.
        }
    }

    private static readonly HashSet<string> ExternalSchemes = new(StringComparer.OrdinalIgnoreCase)
    {
        "http", "https", "mailto", "tel",
    };

    /// <summary>Hands a link to Windows (the default browser / mail app). Other schemes are dropped.</summary>
    private static void OpenExternal(Uri uri)
    {
        if (!ExternalSchemes.Contains(uri.Scheme)) return;
        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception)
        {
            // No handler registered for it; nothing more to do.
        }
    }

    // ─── Updates ────────────────────────────────────────────────────────────

    /// <summary>
    /// Reads /downloads/deskdev-desktop.json on the app's host (written by
    /// build.mjs next to the installer) and shows the banner when it names a
    /// newer version. Silent on any failure: the app works without it.
    /// </summary>
    private async Task CheckForUpdateAsync()
    {
        try
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            var manifestUrl = _address.UpdateManifestUrl;
            var json = await http.GetStringAsync(manifestUrl);
            var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
            if (data == null || !data.TryGetValue("version", out var v) || !Version.TryParse(v as string, out var latest)) return;
            if (Normalize(latest) <= CurrentVersion) return;
            var file = data.TryGetValue("url", out var u) ? u as string : null;
            if (string.IsNullOrEmpty(file) || !Uri.TryCreate(manifestUrl, file, out var installer)) return;
            if (installer.Scheme != Uri.UriSchemeHttps && !installer.IsLoopback) return;
            _updateBar.Offer(Normalize(latest), installer);
        }
        catch (Exception)
        {
            // Offline, or no manifest published yet.
        }
    }

    private static Version Normalize(Version? v) =>
        v == null ? new Version(0, 0, 0) : new Version(v.Major, v.Minor, Math.Max(v.Build, 0));

    // ─── Window chrome ──────────────────────────────────────────────────────

    private static Icon LoadIcon()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("DeskDev.ico");
        return stream != null ? new Icon(stream) : SystemIcons.Application;
    }

    private static bool WindowsUsesDarkTheme()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int light && light == 0;
        }
        catch (Exception)
        {
            return false;
        }
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    /// <summary>A dark title bar to match a dark Windows theme (Windows 10 20H1+ / 11).</summary>
    private static void UseDarkTitleBar(IntPtr handle, bool dark)
    {
        if (!dark) return;
        const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        var on = 1;
        try
        {
            DwmSetWindowAttribute(handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int));
        }
        catch (Exception)
        {
            // Older Windows: the light title bar stays.
        }
    }
}

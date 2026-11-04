using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace DeskDev.Desktop;

/// <summary>
/// The unread count (notifications + chat) on DeskDev's taskbar button: a
/// red badge over the icon, the Windows counterpart of the app badge on a
/// phone. The web app sends the count (pwa/useAppBadge.ts → postMessage);
/// a rise while the window is in the background also flashes the button
/// until it is opened.
/// </summary>
internal sealed class TaskbarBadge : IDisposable
{
    private readonly Form _form;
    private ITaskbarList3? _taskbar;
    private IntPtr _icon = IntPtr.Zero;
    private int _count;

    public TaskbarBadge(Form form)
    {
        _form = form;
        try
        {
            _taskbar = (ITaskbarList3)new TaskbarListCom();
            _taskbar.HrInit();
        }
        catch (Exception)
        {
            _taskbar = null; // No taskbar (a server core session): the count just isn't shown.
        }
    }

    public int Count => _count;

    public void Set(int count)
    {
        count = Math.Max(0, Math.Min(count, 9999));
        if (count == _count) return;
        var rose = count > _count;
        _count = count;

        if (_taskbar != null && _form.IsHandleCreated)
        {
            var previous = _icon;
            _icon = count > 0 ? DrawBadge(count) : IntPtr.Zero;
            var label = count == 0 ? "" : count == 1 ? "1 unread" : $"{count} unread";
            try
            {
                _taskbar.SetOverlayIcon(_form.Handle, _icon, label);
            }
            catch (Exception)
            {
                // Explorer restarting: the next count draws it again.
            }
            if (previous != IntPtr.Zero) DestroyIcon(previous);
        }

        if (rose && !_form.ContainsFocus) Flash();
    }

    /// <summary>A red disc with the count (99+ above 99), drawn for the small-icon size.</summary>
    private static IntPtr DrawBadge(int count)
    {
        const int size = 32; // Windows scales the overlay to the small-icon size for the DPI.
        var text = count > 99 ? "99+" : count.ToString();
        using var bmp = new Bitmap(size, size);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.Clear(Color.Transparent);
            using var fill = new SolidBrush(Color.FromArgb(225, 29, 72)); // rose-600
            using var ring = new Pen(Color.White, 2f);
            g.FillEllipse(fill, 1, 1, size - 3, size - 3);
            g.DrawEllipse(ring, 1, 1, size - 3, size - 3);
            var em = text.Length >= 3 ? 11f : text.Length == 2 ? 14f : 17f;
            using var font = new Font("Segoe UI", em, FontStyle.Bold, GraphicsUnit.Pixel);
            using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            g.DrawString(text, font, Brushes.White, new RectangleF(0, 0, size - 1, size - 1), format);
        }
        return bmp.GetHicon();
    }

    /// <summary>Flash the taskbar button until the window is brought forward.</summary>
    private void Flash()
    {
        if (!_form.IsHandleCreated) return;
        var info = new FLASHWINFO
        {
            cbSize = (uint)Marshal.SizeOf<FLASHWINFO>(),
            hwnd = _form.Handle,
            dwFlags = FLASHW_TRAY | FLASHW_TIMERNOFG,
            uCount = uint.MaxValue,
            dwTimeout = 0,
        };
        FlashWindowEx(ref info);
    }

    public void Dispose()
    {
        if (_icon != IntPtr.Zero) DestroyIcon(_icon);
        _icon = IntPtr.Zero;
        if (_taskbar != null) Marshal.ReleaseComObject(_taskbar);
        _taskbar = null;
    }

    // ─── Win32 ───────────────────────────────────────────────────────────────

    private const uint FLASHW_TRAY = 0x2;
    private const uint FLASHW_TIMERNOFG = 0xC;

    [StructLayout(LayoutKind.Sequential)]
    private struct FLASHWINFO
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    [ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090"), ClassInterface(ClassInterfaceType.None)]
    private class TaskbarListCom
    {
    }

    /// <summary>ITaskbarList3, declared up to SetOverlayIcon in vtable order.</summary>
    [ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList3
    {
        // ITaskbarList
        void HrInit();
        void AddTab(IntPtr hwnd);
        void DeleteTab(IntPtr hwnd);
        void ActivateTab(IntPtr hwnd);
        void SetActiveAlt(IntPtr hwnd);
        // ITaskbarList2
        void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fFullscreen);
        // ITaskbarList3
        void SetProgressValue(IntPtr hwnd, ulong ullCompleted, ulong ullTotal);
        void SetProgressState(IntPtr hwnd, int tbpFlags);
        void RegisterTab(IntPtr hwndTab, IntPtr hwndMDI);
        void UnregisterTab(IntPtr hwndTab);
        void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);
        void SetTabActive(IntPtr hwndTab, IntPtr hwndMDI, uint dwReserved);
        void ThumbBarAddButtons(IntPtr hwnd, uint cButtons, IntPtr pButton);
        void ThumbBarUpdateButtons(IntPtr hwnd, uint cButtons, IntPtr pButton);
        void ThumbBarSetImageList(IntPtr hwnd, IntPtr himl);
        void SetOverlayIcon(IntPtr hwnd, IntPtr hIcon, [MarshalAs(UnmanagedType.LPWStr)] string pszDescription);
    }
}

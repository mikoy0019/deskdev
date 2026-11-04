using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace DeskDev.Desktop;

/// <summary>
/// Where the app points. The installer puts deskdev.json next to DeskDev.exe
/// (written by build.mjs): the address DeskDev should live at, then
/// addresses to fall back on while that one doesn't answer — e.g. the
/// workers.dev address before the domain's DNS cutover, so the same install
/// keeps working before and after it. `DeskDev.exe --url=https://…`
/// overrides all of them for one run, e.g. to try a preview.
/// </summary>
internal sealed class AppConfig
{
    public const string DefaultUrl = "https://workspace.nixgensolutions.com";

    /// <summary>In order of preference; the first that answers is used.</summary>
    public IReadOnlyList<Uri> Candidates { get; }
    public bool DevTools { get; }

    private AppConfig(IReadOnlyList<Uri> candidates, bool devTools)
    {
        Candidates = candidates;
        DevTools = devTools;
    }

    public static AppConfig Load(string[] args)
    {
        string? url = null;
        var devTools = false;
        foreach (var arg in args)
        {
            if (arg.StartsWith("--url=", StringComparison.OrdinalIgnoreCase)) url = arg.Substring("--url=".Length);
            else if (string.Equals(arg, "--devtools", StringComparison.OrdinalIgnoreCase)) devTools = true;
        }

        var candidates = (url != null ? new[] { url } : ReadConfigUrls())
            .Select(ParseHttpUrl)
            .Where(u => u != null)
            .Select(u => u!)
            .ToList();
        if (candidates.Count == 0) candidates.Add(new Uri(DefaultUrl));
        return new AppConfig(candidates, devTools);
    }

    /// <summary>
    /// The first candidate that answers over HTTP at all (any status below
    /// 500). All are asked at once; a DNS name that doesn't exist yet fails
    /// fast. None answering → the first, so the offline page names it.
    /// </summary>
    public async Task<AppAddress> ResolveAsync()
    {
        if (Candidates.Count == 1) return new AppAddress(Candidates[0]);
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(6) };
        var probes = Candidates.Select(async uri =>
        {
            try
            {
                using var res = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead);
                return (int)res.StatusCode < 500;
            }
            catch (Exception)
            {
                return false;
            }
        }).ToList();
        var answers = await Task.WhenAll(probes);
        for (var i = 0; i < Candidates.Count; i++)
        {
            if (answers[i]) return new AppAddress(Candidates[i]);
        }
        return new AppAddress(Candidates[0]);
    }

    private static IEnumerable<string> ReadConfigUrls()
    {
        try
        {
            var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "deskdev.json");
            if (!File.Exists(path)) return Array.Empty<string>();
            var json = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
            if (json == null) return Array.Empty<string>();
            var urls = new List<string>();
            if (json.TryGetValue("url", out var main) && main is string s) urls.Add(s);
            if (json.TryGetValue("fallbackUrls", out var more) && more is IEnumerable list)
            {
                urls.AddRange(list.OfType<string>());
            }
            return urls;
        }
        catch (Exception)
        {
            return Array.Empty<string>(); // A broken file falls back to the default address.
        }
    }

    /// <summary>https anywhere; plain http only for a dev server on this machine.</summary>
    private static Uri? ParseHttpUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (!Uri.TryCreate(value!.Trim(), UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme == Uri.UriSchemeHttps) return uri;
        return uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback ? uri : null;
    }
}

/// <summary>The address in use for this run.</summary>
internal sealed class AppAddress
{
    public Uri StartUrl { get; }

    public AppAddress(Uri startUrl) => StartUrl = startUrl;

    /// <summary>Scheme + host + port; navigations anywhere else open in the browser.</summary>
    public string Origin => StartUrl.GetLeftPart(UriPartial.Authority);

    /// <summary>The installer's version file, published next to the installer on the same host.</summary>
    public Uri UpdateManifestUrl => new(new Uri(Origin), "/downloads/deskdev-desktop.json");
}

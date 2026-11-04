using System;
using System.Net;

namespace DeskDev.Desktop;

/// <summary>Shown in the window when DeskDev can't be reached (offline, DNS, server down).</summary>
internal static class OfflinePage
{
    public static string Html(Uri startUrl, bool dark)
    {
        var url = WebUtility.HtmlEncode(startUrl.AbsoluteUri);
        var host = WebUtility.HtmlEncode(startUrl.Host);
        var bg = dark ? "#0a0c12" : "#ffffff";
        var fg = dark ? "#e7e9ee" : "#0f172a";
        var muted = dark ? "#9aa3b2" : "#475569";
        return $@"<!doctype html>
<html lang=""en""><head><meta charset=""utf-8""><title>DeskDev</title>
<style>
  html,body{{height:100%;margin:0}}
  body{{display:flex;align-items:center;justify-content:center;background:{bg};color:{fg};font:15px/1.5 'Segoe UI',system-ui,sans-serif}}
  main{{max-width:420px;padding:24px;text-align:center}}
  .mark{{width:56px;height:56px;border-radius:14px;background:#2563eb;color:#fff;font:700 30px/56px 'Segoe UI',sans-serif;margin:0 auto 20px}}
  h1{{font-size:20px;margin:0 0 8px}}
  p{{margin:0 0 20px;color:{muted}}}
  a.button{{display:inline-block;padding:9px 18px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600}}
  a.button:hover{{background:#1d4ed8}}
</style></head>
<body><main>
  <div class=""mark"">D</div>
  <h1>Can’t reach DeskDev</h1>
  <p>Check your internet connection. DeskDev lives at {host}; it opens again as soon as that answers.</p>
  <a class=""button"" href=""{url}"">Try again</a>
</main></body></html>";
    }
}

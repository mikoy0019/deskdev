using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace DeskDev.Desktop;

/// <summary>Opens the window where it was last closed (size, position, maximized).</summary>
internal static class WindowPlacement
{
    private const string FileName = "window.txt";

    public static void Restore(Form form, string dataDir)
    {
        form.StartPosition = FormStartPosition.CenterScreen;
        form.Size = new Size(1280, 820);
        try
        {
            var path = Path.Combine(dataDir, FileName);
            if (!File.Exists(path)) return;
            var parts = File.ReadAllText(path).Trim().Split(',');
            if (parts.Length != 5) return;
            var n = parts.Take(4).Select(p => int.Parse(p, CultureInfo.InvariantCulture)).ToArray();
            var bounds = new Rectangle(n[0], n[1], n[2], n[3]);
            // Skip a position on a monitor that's no longer plugged in.
            if (bounds.Width < 400 || bounds.Height < 300) return;
            if (!Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(bounds))) return;
            form.StartPosition = FormStartPosition.Manual;
            form.Bounds = bounds;
            if (parts[4] == "max") form.WindowState = FormWindowState.Maximized;
        }
        catch (Exception)
        {
            // Unreadable: the default centred window.
        }
    }

    public static void Save(Form form, string dataDir)
    {
        try
        {
            Directory.CreateDirectory(dataDir);
            var b = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
            var state = form.WindowState == FormWindowState.Maximized ? "max" : "normal";
            File.WriteAllText(
                Path.Combine(dataDir, FileName),
                string.Join(",", new[] { b.X, b.Y, b.Width, b.Height }.Select(v => v.ToString(CultureInfo.InvariantCulture))) + "," + state);
        }
        catch (Exception)
        {
            // Read-only profile: next launch is centred again.
        }
    }
}

using System;
using System.Drawing;
using System.Windows.Forms;

namespace DeskDev.Desktop;

/// <summary>
/// "DeskDev 1.2.0 is available" across the top of the window. Download hands
/// the installer link to the browser; running it updates DeskDev in place and
/// keeps the sign-in.
/// </summary>
internal sealed class UpdateBar : Panel
{
    private readonly Label _label;
    private readonly Action<Uri> _open;
    private Uri? _installer;

    public UpdateBar(Action<Uri> open)
    {
        _open = open;
        Height = 40;
        Padding = new Padding(14, 0, 8, 0);
        BackColor = Color.FromArgb(37, 99, 235); // brand-600
        ForeColor = Color.White;

        _label = new Label
        {
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft,
            AutoEllipsis = true,
            Font = new Font("Segoe UI", 9.5f),
        };

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Right,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            WrapContents = false,
            Padding = new Padding(0, 6, 0, 0),
            BackColor = Color.Transparent,
        };
        buttons.Controls.Add(MakeButton("Download", bold: true, (_, _) =>
        {
            if (_installer != null) _open(_installer);
            Visible = false;
        }));
        buttons.Controls.Add(MakeButton("Later", bold: false, (_, _) => Visible = false));

        Controls.Add(_label);
        Controls.Add(buttons);
    }

    public void Offer(Version version, Uri installer)
    {
        _installer = installer;
        _label.Text = $"DeskDev {version.ToString(3)} is available. Download it and run the installer to update.";
        Visible = true;
    }

    private static Button MakeButton(string text, bool bold, EventHandler onClick)
    {
        var button = new Button
        {
            Text = text,
            AutoSize = true,
            FlatStyle = FlatStyle.Flat,
            ForeColor = Color.White,
            BackColor = bold ? Color.FromArgb(29, 78, 216) : Color.Transparent,
            Font = new Font("Segoe UI", 9f, bold ? FontStyle.Bold : FontStyle.Regular),
            Margin = new Padding(6, 0, 0, 0),
            Padding = new Padding(8, 0, 8, 0),
            Cursor = Cursors.Hand,
        };
        button.FlatAppearance.BorderColor = Color.FromArgb(147, 197, 253);
        button.FlatAppearance.BorderSize = bold ? 0 : 1;
        button.Click += onClick;
        return button;
    }
}

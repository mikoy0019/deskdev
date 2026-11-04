using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace DeskDev.Desktop;

internal static class Program
{
    // Per user session: a second launch hands over to the window already open.
    private const string MutexName = @"Local\NixGen.DeskDev.Desktop";
    private const string ActivateEventName = @"Local\NixGen.DeskDev.Desktop.Activate";

    [STAThread]
    private static int Main(string[] args)
    {
        using var mutex = new Mutex(true, MutexName, out var first);
        if (!first)
        {
            try
            {
                using var activate = EventWaitHandle.OpenExisting(ActivateEventName);
                activate.Set();
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                // The other instance is still starting or just closed; nothing to wake.
            }
            return 0;
        }

        using var activateEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ActivateEventName);

        // Same id as the installer's shortcuts: one taskbar button, pins stick.
        SetCurrentProcessExplicitAppUserModelID("NixGen.DeskDev");

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var config = AppConfig.Load(args);
        using var form = new MainForm(config);

        // Waits for "show yourself" from a second launch, off the UI thread.
        var waiter = new Thread(() =>
        {
            while (activateEvent.WaitOne())
            {
                if (form.IsDisposed) return;
                try
                {
                    form.BeginInvoke(new Action(form.ShowFromSecondLaunch));
                }
                catch (InvalidOperationException)
                {
                    return; // Closing.
                }
            }
        })
        { IsBackground = true, Name = "DeskDev activation" };
        waiter.Start();

        Application.Run(form);
        return 0;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
}

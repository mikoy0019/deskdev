; DeskDev for Windows — the installer (Inno Setup 6). Built by ../build.mjs,
; which passes AppVersion, AppDir (the built app) and OutDir:
;   ISCC /DAppVersion=1.0.0 /DAppDir=..\dist\app /DOutDir=..\dist DeskDev.iss
;
; Per-user install: no admin prompt, lands in %LOCALAPPDATA%\Programs\DeskDev,
; Start menu entry, optional desktop icon, uninstaller in Settings → Apps.
; Running a newer installer over it updates in place (same AppId) and keeps
; the sign-in, which lives in %LOCALAPPDATA%\DeskDev.

#ifndef AppVersion
  #error Pass /DAppVersion=x.y.z (build.mjs does)
#endif
#ifndef AppDir
  #define AppDir "..\dist\app"
#endif
#ifndef OutDir
  #define OutDir "..\dist"
#endif

[Setup]
; Never change AppId: it is how Windows knows a new installer updates this app.
AppId={{B824BA9C-7DB9-4344-8DD0-A8F5EDCA0D61}
AppName=DeskDev
AppVersion={#AppVersion}
AppVerName=DeskDev {#AppVersion}
AppPublisher=NixGen Solutions
AppPublisherURL=https://nixgensolutions.com
AppSupportURL=https://nixgensolutions.com
VersionInfoVersion={#AppVersion}
VersionInfoProductName=DeskDev
VersionInfoDescription=DeskDev Setup
DefaultDirName={localappdata}\Programs\DeskDev
DefaultGroupName=DeskDev
DisableProgramGroupPage=yes
DisableDirPage=auto
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Windows 10 1809 or later (WebView2 and per-monitor DPI).
MinVersion=10.0.17763
OutputDir={#OutDir}
OutputBaseFilename=DeskDev-Setup
SetupIconFile=..\DeskDev.ico
UninstallDisplayIcon={app}\DeskDev.exe
UninstallDisplayName=DeskDev
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=100
; An update closes a running DeskDev first, and opens it again afterwards.
CloseApplications=force
RestartApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Put a DeskDev icon on the desktop"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\DeskDev"; Filename: "{app}\DeskDev.exe"; AppUserModelID: "NixGen.DeskDev"
Name: "{autodesktop}\DeskDev"; Filename: "{app}\DeskDev.exe"; Tasks: desktopicon; AppUserModelID: "NixGen.DeskDev"

[Run]
Filename: "{app}\DeskDev.exe"; Description: "Open DeskDev"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The app's own profile: sign-in, cache, window position.
Type: filesandordirs; Name: "{localappdata}\DeskDev"

[Code]
const
  WebView2ClientKey = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Download = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

function HasWebView2Version(Root: Integer; Key: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(Root, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0');
end;

// Windows 11 always has it; most Windows 10 PCs got it with Edge.
function WebView2Installed(): Boolean;
begin
  Result := HasWebView2Version(HKLM, 'SOFTWARE\WOW6432Node\' + WebView2ClientKey)
    or HasWebView2Version(HKLM, 'SOFTWARE\' + WebView2ClientKey)
    or HasWebView2Version(HKCU, 'Software\' + WebView2ClientKey);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ErrorCode: Integer;
begin
  if (CurStep = ssPostInstall) and not WebView2Installed() then
  begin
    if SuppressibleMsgBox('DeskDev needs the Microsoft Edge WebView2 Runtime, which is not on this PC yet.' + #13#10#13#10 +
      'Open Microsoft''s download page now? Install it, then open DeskDev.',
      mbConfirmation, MB_YESNO, IDYES) = IDYES then
      ShellExec('open', WebView2Download, '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;
end;

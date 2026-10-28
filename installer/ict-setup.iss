; ICT App Windows installer (Inno Setup 6). Built by .github/workflows/windows.yml.
; One installer; the first page asks: Server PC, Student PC or Smart board (spec 1).

#define AppName "ICT App"
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
; Folder with the staged files, laid out by the CI job:
;   stage\client\ict-client.exe
;   stage\server\{node.exe, server.cjs, node_modules\better-sqlite3\..., ict-server.exe, ict-server.xml}
#ifndef Stage
  #define Stage "..\stage"
#endif

[Setup]
AppId={{6E0D5B7A-3C1F-4B8E-9C2D-1A7F4E2B9D10}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=i3w
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=ICT-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\ict-client.exe

[Files]
Source: "{#Stage}\client\ict-client.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Stage}\server\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs; Check: IsServer

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\ict-client.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\ict-client.exe"
; Lab PCs and boards open the app when Windows starts.
Name: "{commonstartup}\{#AppName}"; Filename: "{app}\ict-client.exe"; Check: not IsServer

[Run]
; Server only: firewall rules on Private networks (spec 7.3), then the Windows service.
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""ICT App API"" dir=in action=allow protocol=TCP localport=7700 profile=private"; Flags: runhidden; Check: IsServer
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""ICT App Finder"" dir=in action=allow protocol=UDP localport=7701 profile=private"; Flags: runhidden; Check: IsServer
Filename: "{app}\server\ict-server.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; Check: IsServer
Filename: "{app}\server\ict-server.exe"; Parameters: "start"; Flags: runhidden waituntilterminated; Check: IsServer
Filename: "{app}\ict-client.exe"; Description: "Open {#AppName}"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{app}\server\ict-server.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopService"; Check: IsServerInstalled
Filename: "{app}\server\ict-server.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveService"; Check: IsServerInstalled
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""ICT App API"""; Flags: runhidden; RunOnceId: "FwApi"
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""ICT App Finder"""; Flags: runhidden; RunOnceId: "FwFinder"

[Code]
var
  RolePage: TInputOptionWizardPage;
  AdminPage: TInputQueryWizardPage;

function IsServer: Boolean;
begin
  Result := RolePage.SelectedValueIndex = 0;
end;

function IsServerInstalled: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\server\ict-server.exe'));
end;

function RoleId: String;
begin
  case RolePage.SelectedValueIndex of
    0: Result := 'console';
    1: Result := 'student';
  else
    Result := 'board';
  end;
end;

procedure InitializeWizard;
begin
  RolePage := CreateInputOptionPage(wpWelcome,
    'What is this PC?', 'Choose how this PC is used in the lab.',
    'Pick one. Each PC in the lab gets the same installer.', True, False);
  RolePage.Add('Server PC (runs the lab; admin and teachers use the console here)');
  RolePage.Add('Student PC');
  RolePage.Add('Smart board (a Windows PC used as the classroom board)');
  RolePage.SelectedValueIndex := 1;

  AdminPage := CreateInputQueryPage(RolePage.ID,
    'First admin account', 'Create the Super Admin for this school.',
    'You will use this to sign in to the console. The password needs at least 8 characters.');
  AdminPage.Add('Username:', False);
  AdminPage.Add('Password:', True);
  AdminPage.Values[0] := 'admin';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = AdminPage.ID) and not IsServer;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = AdminPage.ID) and (Length(AdminPage.Values[1]) < 8) then
  begin
    MsgBox('The password needs at least 8 characters.', mbError, MB_OK);
    Result := False;
  end;
end;

function JsonEscape(S: String): String;
begin
  StringChangeEx(S, '\', '\\', True);
  StringChangeEx(S, '"', '\"', True);
  Result := S;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  DataDir: String;
  ResultCode: Integer;
begin
  // ssInstall runs before files are copied and before [Run], so the service sees these files on first start.
  if CurStep = ssInstall then
  begin
    // On upgrade, stop the running service before its files are replaced.
    if IsServer and IsServerInstalled then
      Exec(ExpandConstant('{app}\server\ict-server.exe'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

    // The app reads this to skip its own "What is this device?" screen.
    ForceDirectories(ExpandConstant('{app}'));
    SaveStringToFile(ExpandConstant('{app}\install-role.txt'), RoleId, False);

    if IsServer then
    begin
      // One-time file: the server creates the account and deletes it on first start.
      DataDir := ExpandConstant('{commonappdata}\ICT App\server');
      ForceDirectories(DataDir);
      SaveStringToFile(DataDir + '\bootstrap-admin.json',
        '{"username":"' + JsonEscape(AdminPage.Values[0]) + '","password":"' + JsonEscape(AdminPage.Values[1]) + '"}', False);
    end;
  end;
end;

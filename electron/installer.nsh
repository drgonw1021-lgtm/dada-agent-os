; NSIS pre-install script for DaDa
; Cleans up stale data from previous versions before installing new version

!macro customInit
  ; Detect previous installation and warn user
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  ${If} $R0 != ""
  ${OrIf} $R1 != ""
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION \
      "DaDa is already installed.$\n$\nClick OK to upgrade to version ${VERSION}.$\nYour settings (.env.local) and downloaded models will be preserved." \
      IDOK upgrade IDCANCEL cancel
    upgrade:
      ; Continue with installation (overwrites old program files)
      Goto done
    cancel:
      Quit
    done:
  ${EndIf}
!macroend

!macro customInstall
  ; Delete stale checkpoint files that could cause task recovery issues
  ${If} ${FileExists} "$INSTDIR\.agent\checkpoints\*.*"
    RMDir /r "$INSTDIR\.agent\checkpoints"
    CreateDirectory "$INSTDIR\.agent\checkpoints"
  ${EndIf}
  ; Remove any interrupted task markers
  ${If} ${FileExists} "$INSTDIR\.agent\tasks.json"
    ; Keep tasks.json but it will be cleaned on next startup
  ${EndIf}
!macroend

!macro customUninstall
  ; Ask whether to keep user data
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to keep your DaDa user data?$\n$\nThis includes:$\n- API configuration (.env.local)$\n- Downloaded models (models/)$\n- Task history and skills (.agent/)$\n$\nClick YES to keep (recommended) or NO to remove everything." \
    IDYES keep IDNO remove
  keep:
    Goto uninst_done
  remove:
    RMDir /r "$INSTDIR\.agent"
    RMDir /r "$INSTDIR\models"
    Delete "$INSTDIR\.env.local"
    Delete "$INSTDIR\.env"
  uninst_done:
!macroend

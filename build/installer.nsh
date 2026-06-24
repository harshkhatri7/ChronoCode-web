; ChronoCode NSIS Custom Installer Script
; Auto-detects old version, removes it, installs new, launches app

!macro customInit
  ; Kill any running ChronoCode process before install
  nsExec::ExecToLog 'taskkill /F /IM ChronoCode.exe /T 2>nul'
  Sleep 500
  
  ; Detect and remove old installation
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_FILENAME}" "UninstallString"
  ${If} $0 != ""
    DetailPrint "Old version detected. Removing previous installation..."
    ; Run old uninstaller silently
    nsExec::ExecToLog '$0 /S'
    Sleep 1000
  ${EndIf}
  
  ; Also check for old installs in common locations
  IfFileExists "$LOCALAPPDATA\Programs\chronocode-desktop\Uninstall ChronoCode Desktop.exe" 0 +3
    DetailPrint "Removing legacy installation..."
    nsExec::ExecToLog '"$LOCALAPPDATA\Programs\chronocode-desktop\Uninstall ChronoCode Desktop.exe" /S'
    Sleep 1000
!macroend

!macro customInstallMode
  ; Force current-user install, no elevation needed
  StrCpy $isForceCurrentInstall "1"
!macroend

!include LogicLib.nsh
!include nsDialogs.nsh

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifndef BUILD_UNINSTALLER
  Var khutRepair
  Var khutShortcut
  Var khutShortcutBox
  Var khutInstallButton
  Var khutRepairButton
  Var khutRemoveButton

  !macro customWelcomePage
    Page custom khutChoosePage khutChooseLeave

    Function khutChoosePage
      StrCpy $khutRepair "0"
      !insertmacro MUI_HEADER_TEXT "${PRODUCT_NAME} Setup" "Choose what you want to do."
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateRadioButton} 0 0 100% 12u "Install ${PRODUCT_NAME}"
      Pop $khutInstallButton
      ${NSD_CreateLabel} 12u 14u 95% 18u "Installs ${PRODUCT_NAME}, or updates it to this version. Your keys, settings and database are kept."
      Pop $0
      ${NSD_CreateRadioButton} 0 40u 100% 12u "Repair ${PRODUCT_NAME}"
      Pop $khutRepairButton
      ${NSD_CreateLabel} 12u 54u 95% 18u "Reinstalls the app and clears its cache. Your keys, settings and database are kept."
      Pop $0
      ${NSD_CreateRadioButton} 0 80u 100% 12u "Uninstall ${PRODUCT_NAME}"
      Pop $khutRemoveButton
      ${NSD_CreateLabel} 12u 94u 95% 18u "Removes the app and deletes its keys, settings and database."
      Pop $0
      ${NSD_CreateCheckbox} 0 122u 100% 12u "Create a desktop shortcut"
      Pop $khutShortcutBox
      ${NSD_Check} $khutShortcutBox
      ${NSD_Check} $khutInstallButton
      ${IfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        EnableWindow $khutRepairButton 0
        EnableWindow $khutRemoveButton 0
      ${EndIf}
      nsDialogs::Show
    FunctionEnd

    Function khutChooseLeave
      ${NSD_GetState} $khutShortcutBox $khutShortcut
      ${NSD_GetState} $khutRepairButton $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $khutRepair "1"
      ${EndIf}
      ${NSD_GetState} $khutRemoveButton $0
      ${If} $0 == ${BST_CHECKED}
        MessageBox MB_YESNO|MB_ICONEXCLAMATION "Uninstall ${PRODUCT_NAME} and delete its keys, settings and database? This can't be undone." IDYES khutRemove
        Abort
        khutRemove:
        ExecWait '"$INSTDIR\${UNINSTALL_FILENAME}" /S --delete-app-data _?=$INSTDIR'
        Delete "$INSTDIR\${UNINSTALL_FILENAME}"
        RMDir /r "$INSTDIR"
        MessageBox MB_ICONINFORMATION "${PRODUCT_NAME} was uninstalled."
        Quit
      ${EndIf}
    FunctionEnd
  !macroend

  !macro customInstall
    ${If} $khutShortcut == ${BST_CHECKED}
      CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      WinShell::SetLnkAUMI "$DESKTOP\${PRODUCT_NAME}.lnk" "${APP_ID}"
    ${Else}
      Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
    ${EndIf}
    ${If} $khutRepair == "1"
      FindFirst $0 $1 "$APPDATA\${PRODUCT_NAME}\*"
      khutClean:
        StrCmp $1 "" khutCleaned
        StrCmp $1 "." khutNext
        StrCmp $1 ".." khutNext
        StrCmp $1 "bot" khutNext
        StrCmp $1 "app.json" khutNext
        RMDir /r "$APPDATA\${PRODUCT_NAME}\$1"
        Delete "$APPDATA\${PRODUCT_NAME}\$1"
      khutNext:
        FindNext $0 $1
        Goto khutClean
      khutCleaned:
      FindClose $0
    ${EndIf}
  !macroend
!endif

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.${PRODUCT_NAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${APP_ID}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "electron.app.${PRODUCT_NAME}"
    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION "Also delete ${PRODUCT_NAME}'s keys, settings and database?" /SD IDNO IDNO khutKeepData
      RMDir /r "$APPDATA\${PRODUCT_NAME}"
      khutKeepData:
    ${EndIf}
  ${EndIf}
!macroend

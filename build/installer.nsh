; LUMA's additions to the electron-builder installer.

; Uninstalling (not updating): ask whether the library goes too. Downloaded
; songs in Music\LUMA are never touched. %APPDATA% is read from the person
; running the uninstaller, so an all-users install never deletes anyone else's.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your LUMA library?$\r$\n$\r$\nThat's your liked songs, playlists, history and sign-ins on this PC. Choose No to keep them for next time.$\r$\n$\r$\nDownloaded songs in Music\LUMA are kept either way." /SD IDNO IDNO luma_keep_library
      ExpandEnvStrings $0 "%APPDATA%"
      RMDir /r "$0\LUMA"
    luma_keep_library:
  ${endIf}
!macroend

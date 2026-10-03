; Included by electron-builder's NSIS installer (package.json → build.nsis.include).
;
; The hub listens on TCP 4000 for the tablets. Without a rule Windows shows an
; "allow access?" prompt on first run, and if the shop wifi is classed as a
; Public network the tablets are silently blocked. The installer runs elevated
; (perMachine), so it can add the rule itself. Scoped to this program only.
;
; Lives in installer/, not build/: build/ is gitignored, and the CI runner
; builds from git — the original file was never committed and was lost.

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Al Manzil POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Al Manzil POS" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=any'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Al Manzil POS"'
!macroend

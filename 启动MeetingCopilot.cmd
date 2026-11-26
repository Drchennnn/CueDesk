@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
if exist "%~dp0releases\MeetingCopilot-V3.2\MeetingCopilot.exe" (
  start "" "%~dp0releases\MeetingCopilot-V3.2\MeetingCopilot.exe"
) else if exist "%~dp0releases\MeetingCopilot-V3.2\app\MeetingCopilot.exe" (
  start "" "%~dp0releases\MeetingCopilot-V3.2\app\MeetingCopilot.exe"
) else (
  start "" "%~dp0releases\MeetingCopilot\app\MeetingCopilot.exe"
)

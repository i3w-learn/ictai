# ICT App: notes for anyone (or any AI) working in this repo

## Where this runs: Windows, not the Mac

The code is written on a Mac. The app is installed and used **only on Windows**:

- **Server PC** (Windows): installed with `ICT-Setup`. The server runs as the `ICTServer` Windows
  service and keeps its data in `C:\ProgramData\ICT App\server\`.
- **Student lab PCs** (Windows, up to 60): installed with `ICT-Student-Setup`.
- **Smart board** (Windows): installed with `ICT-Setup`, choosing "Smart board".

The lab has **no internet**. Everything goes over the school's own network. PCs are switched off
at night.

So, in every answer, plan and feature:

- Talk about the Windows install first: Windows paths, the Windows service, the installers.
  The Mac paths (`server/.data/`, `just server`, `just app`) are only for writing code; mention
  them only when the question is about the dev setup.
- Think about how new code behaves on Windows: paths with `\`, files that are locked while open,
  the firewall (TCP 7700, UDP 7701 on Private networks), the service running with no user signed in.
- Do not plan anything that needs the internet, or that needs the Server PC to be on at night.
- The Windows build cannot be made or run on the Mac. GitHub makes it on every push
  (`.github/workflows/windows.yml`); the installers are in the run's Artifacts. Say plainly when
  something has only been tried on the Mac.

## How to test on Windows

The step-by-step test for real Windows PCs is in `docs/windows-test-guide.md`. When a change
touches something that test covers, say which steps should be run again.

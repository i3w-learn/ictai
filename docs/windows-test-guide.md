# How to test the app on Windows

The code is written on a Mac, but the app runs only on Windows. This is the test to do on real
Windows PCs after every new build. It takes about 20 minutes.

## What you need

- Two Windows PCs: one to be the **Server PC**, one to be a **student PC**.
- Both on the **same network**: the same switch by cable, or the same Wi-Fi. No internet is needed.
- The two installers. Download them from the newest green run of the `windows` workflow on GitHub
  (bottom of the run page, "Artifacts"): `ICT-Setup` and `ICT-Student-Setup`.
- One PDF and one small video on the Server PC, to show to the class.

If you have only one Windows PC, see "Only one Windows PC" at the end.

## Step 1: Server PC

1. Double-click `ICT-Setup-<version>.exe`.
2. Windows says "Windows protected your PC" (the installer is not signed). Press **More info**,
   then **Run anyway**.
3. On "What is this PC?" choose **Server PC**.
4. Type a username and a password (8 letters or more) for the first Super Admin. Remember them.
5. Finish. The app opens. Sign in with that username and password.

Check: Windows Start menu → type `services` → open **Services** → `ICTServer` must say **Running**.

## Step 2: Student PC

1. Double-click `ICT-Student-Setup-<version>.exe`. Again **More info** → **Run anyway**.
2. It asks nothing. The app opens and looks for the server by itself.

Check on the student PC: the top of the app shows your school name and "Student PC".
Check on the Server PC: **School** page → **Devices** lists the student PC as **Connected**.

## Step 3: Make a class and a student (Server PC)

1. **School** → Students → type a class name (say `6`) → **Add class**.
2. Choose Class 6. Type a student name and roll number `1` → **Add student**.

## Step 4: Sign in as the student (student PC)

1. Press **6**, type roll number **1**, press **Next**, then **Yes, that is me**.

Check: the student's home page opens with their name at the top.

Check on the Server PC: **Today** → **Attendance** → Class 6 shows the student as **Present**, with the
time they signed in. Press **Mark absent**, then **Mark present**: the list changes each time.

## Step 5: Show to class (the main test)

Do each one from the Server PC and watch the student PC.

| Do this on the Server PC | The student PC must |
| --- | --- |
| **Teach** → add your PDF to Class 6 → **Open** → **Show to Class 6** | open the same PDF on page 1 |
| Press **Next** | turn to page 2 |
| Press the **Pen** and write on the page | show the same line in the same place |
| **Stop showing** | go back to the home page |
| **Teach** → **Whiteboard** → Class 6 → **Start whiteboard**, write, **Add page** | show the board, the writing, then page 2 |
| On the student PC press **Ask for the pen**; on the Server PC press **Allow** | get pen tools; what the student writes shows on the Server PC |
| **Take the pen back** | lose the pen tools |
| Add your video to Class 6 → **Open** → **Show to Class 6** → play, pause, skip | play, pause and skip at the same moments |

## Step 5a: Lock the screens

1. Server PC: **School** → **Devices** → **Lock all screens**.

Check on the student PC: within a second the whole screen is covered by **Look at your teacher**. Nothing
behind it can be clicked, and the keyboard does nothing. It is the same whether a student is signed
in or the PC is waiting on the sign-in screen.

2. Server PC: **Unlock all screens**. The student PC is back where it was.
3. Try **Lock screen** on one PC's line: only that PC is covered.
4. Lock a screen, then restart the student PC. When the app opens again it is still locked.

## Step 5b: Our locked videos

Our own videos and books come locked: the file name ends in `.ictlock` and it plays only inside
ICT App. Do this when you have the pack with the `videos` folder and `2-add-videos.bat`.

1. Server PC: double-click `2-add-videos.bat` and say **Yes** when Windows asks.
2. Wait a minute. Open **Videos**: every video from the folder is there, under its class.
3. Open one. Play, pause and skip to the middle. Do the last row of Step 5 with it.
4. Student PC: sign in as a student of that class → **Videos** → the video plays.

Check that the file is no use outside the app: in `C:\Program Files\ICT App\server\starter-videos\`
double-click a `.ictlock` file, or try to open it with a video player. It must not play.

## Step 6: A quick quiz

1. Server PC: **Today** → **New quiz** → Class 6, two questions → save → **Start Lab Mode**.
2. Student PC: **Join the quiz**. Server PC: **Start quiz**.
3. Student answers. Server PC shows the live score. Press **End quiz**.

## Step 7: Switch off and on

1. Restart the Server PC. Do not open anything.
2. Restart the student PC. The app opens by itself and finds the server again.
3. Sign in on the Server PC. The class, the student and the quiz result must still be there.

## Step 8: Smart board (when you have one)

1. Connect the Server PC to the board with **HDMI** (picture) and **USB** (touch).
2. Do Step 5 again, writing on the board with the board's pen.

Check: lines are smooth, land where the pen touches, and show on the student PC.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| Student PC says "Nothing found yet" | On the Server PC, Windows Settings → Network: set the network to **Private**, not Public. Then **Search again**. |
| Still not found | Type the Server PC's address in "Or type the server address". Find it on the Server PC: Start → `cmd` → `ipconfig` → "IPv4 Address". |
| Still not found on Wi-Fi | Some Wi-Fi (offices, colleges, guest Wi-Fi) stops PCs talking to each other. Use a cable and a switch, or a phone hotspot. |
| `ICTServer` is not Running | Open `C:\ProgramData\ICT App\server\startup.log`. It says why. |
| Anything else odd | Copy `C:\ProgramData\ICT App\server\events.log` (the server's diary) and send it with a screenshot. |

## Start again from nothing

Windows Settings → Apps → uninstall **ICT App** on both PCs. To also wipe the data, delete the
folder `C:\ProgramData\ICT App` on the Server PC. Then install again.

## Only one Windows PC

The server can run on the Mac while writing code, with the Windows PC as the student PC. This
tests the Windows student app and the network, but **not** the Windows server or its installer.

1. Mac and Windows PC on the same Wi-Fi.
2. On the Mac, in the repo: `just server` in one terminal, `just app` in another
   (sign in: `admin` / `admin123`).
3. On the Windows PC: install `ICT-Student-Setup`.
4. If it does not find the server: switch off the Mac firewall for the test
   (System Settings → Network → Firewall), or type the Mac's address on the student PC.
5. Continue from Step 3.

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

## Step 4a: Marathi

1. Student PC, on the sign-in screen: press **मराठी** in the top bar. Every word on the screen changes.
2. Sign in. The menu, the home page and every student page are in Marathi. Names of students, books
   and subjects stay as the teacher typed them.
3. Check that the Marathi letters are whole and clear (no empty boxes), also in **माझ्या नोंदी** while typing.
4. Close the app and open it again: it is still in Marathi. Press **English** to go back.

The teacher's pages on the Server PC are still in English only; the switch is there but changes little.

## Step 4b: The student PC is locked down

On the student PC, with the student signed in, try each of these. Every one must do **nothing**:

- Right-click anywhere (no menu with "Save as", "Print" or "Inspect").
- Press **Ctrl+P** (print), **Ctrl+S** (save), **Ctrl+J** (downloads), **F12** and **F5**.
- Drag a picture from **My books** out of the window onto the desktop.

Typing, **Ctrl+C** and **Ctrl+V** must still work, for example in **My notes**.

Check on the Server PC: **Today** → **Download for Excel** still saves a file, and right-click still works.
The lock-down is for student PCs only.

This does not stop **Alt+Tab** or the **Windows** key. Keeping students inside one app is a Windows
setting (kiosk mode, "Assigned access"), not something the app can do by itself.

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

## Step 4c: Word, Excel and PowerPoint files

These need **LibreOffice** on the Server PC. It is free. The lab has no internet, so download its
Windows installer (`LibreOffice_..._Win_x86-64.msi`, about 350 MB) on another PC, carry it over on a
pen drive, and install it with every question left as it is. Nothing needs restarting.

1. Server PC: **Teach** → **Library** → pick a `.docx`, `.xlsx` or `.pptx` file → Class 6 → **Add file**.
   After "Sending…" it says "Turning … into a PDF". The first file after installing can take a minute.
2. The item shows in the library as a **PDF**. **Open** it: every page is there and reads right.
3. **Show to Class 6**: the student PC opens it like any other PDF.

Without LibreOffice, step 1 must stop with a message that names LibreOffice and the Server PC,
and nothing is added to the library.

## Step 5a: Lock the screens

1. Server PC: **School** → **Devices** → **Lock all screens**.

Check on the student PC: within a second the whole screen is covered by **Look at your teacher**. Nothing
behind it can be clicked, and the keyboard does nothing. It is the same whether a student is signed
in or the PC is waiting on the sign-in screen.

2. Server PC: **Unlock all screens**. The student PC is back where it was.
3. Try **Lock screen** on one PC's line: only that PC is covered.
4. Lock a screen, then restart the student PC. When the app opens again it is still locked.

## Step 5a-2: Locking by the timetable

The lab PCs can lock themselves when no class is booked in the lab. Both PCs must show the right
time and day for this test (it does not work on a Sunday: there are no lab periods then).

1. Server PC: **School** → **Settings**. Add a period that is running now (for example, if it is
   10:12, from 10:00 to 11:00). Tick **Lock the lab PCs when no class is booked in the lab**. Save.
2. Server PC: **School** → **Timetable**. Give any class the lab in that period, today.

Check on the student PC: it is **not** covered. A class is booked, so the lab is open.

3. Server PC: **Settings**. Change the period so that it has already ended (10:00 to 10:05). Save.

Check on the student PC: within 15 seconds it is covered by **The lab is closed for now** (not
"Look at your teacher": no teacher locked it). Press the मराठी button first on one try: the words
must be in Marathi.

4. Server PC: **Devices** → **Unlock all screens**. The student PC opens. Wait one minute: it must
   **stay** open. (A teacher's own unlock holds until the next period starts or ends.)
5. Change the period back so that it is running now, save, and wait 15 seconds. Then change it to
   have ended again, and save. The student PC is covered again within 15 seconds.
6. Untick the switch and save. Within 15 seconds the student PC opens, and it does not lock again.
7. Server PC: Windows Start menu → **Services** → restart `ICTServer` with the switch ticked and the
   period ended. The student PC is covered within a few seconds of the service starting.

After this, do Step 5a once more: locking by hand must work as before.

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

## Step 6-2: A quiz as practice

1. Server PC: **Today** → on the quiz's line press **Give as practice**. The page says "Practice".
2. Student PC: nothing pops up. Open **Things to do**: the quiz is under **Practice quizzes**. Press **Start**.

Check: there is **no clock**. Wait three minutes on a question; it must still be there.

3. Answer every question, one of them wrong. The score shows, with **Try again**. The student did not
   have to press anything to hand it in.
4. Press **Try again** and answer all of them right. The page says "Best so far" with the better score
   and "Tries: 2".
5. Server PC: the line for that student shows 2 tries and the best score, without pressing anything.
6. Server PC: go back to **Today**. The quiz's line says **Practice is open** with **See it**. It has no
   Start button while practice is open.
7. With the student in the middle of a practice try, start **Lab Mode** for another quiz (or use Show to
   class). It must come up **over** the practice on the student PC.
8. Server PC: **See it** → **End practice**. On **Today** the quiz's line now has **Practice scores**.
9. Server PC: **Reports**. The practice score must **not** be in the student's results.

## Step 6-3: A quiz in teams (two student PCs are better; one is enough)

1. Server PC: **Today** → on the quiz's line choose **2 teams** → **Start Lab Mode**.
2. Student PC: **Join the quiz**. The waiting page shows the student's team by colour, for example
   **Team Red**. On the Server PC the student's name has the same colour.
3. Server PC: **Start quiz**. The student answers. The Server PC shows **Teams** with each team's
   average, and a **Team** column in the list.
4. When the student is done, the student PC shows the teams and marks **Your team**.
5. Server PC: **End quiz**. The page says "Teams · final places", with a cup for the best team.

After these, do Step 6 once more: a plain quiz with no teams must work as before.

## Step 6a: An activity

One activity comes with the app: **Addition practice**, for Class 6.

1. Student PC (a Class 6 student): **My books** → **Addition practice**. Ten sums come up, one at a time.
2. Answer all ten. The end screen shows the score, and a line above it says **You got … of 10**.
3. Server PC: **Teach** → **Library** → open **Addition practice**. Under the activity, the table shows
   that student with the same score and **1** try. Press **Refresh** after the student plays again:
   tries goes up, and the best score stays the best.

Check: the activity plays with the network cable of the *student PC's internet* out, as always in the lab.
If the box where the activity should be stays empty on Windows, say so: that part has only been
tried in a browser on the Mac.

## Step 6b: A poll

1. Server PC: **Today** → **Polls** → Class 6 → type a question → **Ask the class**.

Check on the student PC: the question pops up at once, over whatever was open.

2. Student: tap an answer. The popup goes away.

Check on the Server PC: the bar for that answer grows by one, without pressing anything.

3. Ask a second poll with **1 to 5 stars**. The first poll shows as **Closed**. The student taps a star.
4. Press **Close poll**. The student no longer sees it.

## Step 6c: Plan a lesson with AI (only when the AI kit is on the Server PC)

1. Server PC: **Today** → **Quizzes** → **Plan a lesson**.
2. Class 6, a subject, a topic (say `Fractions`), 40 minutes → **Plan the lesson**.
3. Wait. The first plan after the Server PC starts takes longest, because the AI has to load.

Check: the plan has what students will learn, four to six timed steps that add up to **40 minutes**,
questions to ask the class, and homework. **Print or PDF** opens a clean page of it.

Without the AI kit the page says that AI is not installed, and nothing else on the page is offered.

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

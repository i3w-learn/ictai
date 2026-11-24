# Activities: how to write one

An activity is a small interactive lesson or game. It runs with no internet and tells ICT App the
student's score when it is done.

## The rules

1. **One file.** An activity is a single `.html` file. Its script, its styles and its pictures are all
   inside that file. (A picture goes in as a `data:` address.)
2. **A closed box.** ICT App runs the file where it cannot reach the internet, other files, the rest
   of the app, or anything on the PC. A link to a script or a picture somewhere else will not load.
3. **Say the score once the student is done.** Put this line where the activity ends:

   ```js
   parent.postMessage({ ict: 'activity', type: 'done', score: 8, max: 10 }, '*');
   ```

   `score` and `max` are whole numbers, and `score` is not more than `max`. The student may play
   again; every try is kept, and the teacher sees the best one.

There is a full example in `installer/activities/`: "Addition practice".

## Putting it in the library

- **A teacher** adds it like any file: **Teach → Library → Add file**, and picks the `.html` file.
  Students find it under **My books**.
- **With the installer.** A file in `installer/activities/` named like a starter video
  (`G6-Eng-Mat-01Add01-Addition practice-ICT.html`: G6 = Class 6, Mat = Maths, then the title) is
  put in the library the first time the server runs.

## What the teacher sees

Opening the activity on the Server PC shows it the way students see it, and under it every student
of the class with their best score and number of tries. Activities are for practice: their scores
are not used for report cards.

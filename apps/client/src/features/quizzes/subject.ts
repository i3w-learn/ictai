// The server matches subjects without caring about capitals, so "maths" is the teacher's "Maths".
export const matchSubject = (subjects: string[], value: string) =>
  subjects.find((s) => s.toLowerCase() === value.trim().toLowerCase()) ?? value;

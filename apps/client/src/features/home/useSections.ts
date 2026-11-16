import { useEffect, useState } from 'react';
import type { Section } from '@ict/contracts';
import { useApp } from '../../app/app-context';

// The sections of the class picked, for a form's "Section" list. Empty while no class is picked and
// until the answer for this class arrives, so one class's sections are never offered for another.
export function useSections(classId: string): Section[] {
  const { call } = useApp();
  const [got, setGot] = useState<{ classId: string; list: Section[] }>({ classId: '', list: [] });
  useEffect(() => {
    if (!classId) return;
    let current = true;
    call('GET /api/v1/sections', { query: { classId } }).then((list) => { if (current) setGot({ classId, list }); }, () => undefined);
    return () => { current = false; };
  }, [call, classId]);
  return classId && got.classId === classId ? got.list : [];
}

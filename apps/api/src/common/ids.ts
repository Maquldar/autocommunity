import { v7 } from 'uuid';

/** Time-ordered UUID v7 used for every primary key. */
export const newId = (): string => v7();

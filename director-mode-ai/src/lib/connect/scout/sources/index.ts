import type { SourceAdapter } from '../types';
import { rspa } from './rspa';
import { mycoachingtree } from './mycoachingtree';
import { ptr } from './ptr';
import { kkandw } from './kkandw';
import { hospitalityonline } from './hospitalityonline';

/** Order matters: the first source to report a fingerprint owns the row. */
export const SOURCES: SourceAdapter[] = [rspa, ptr, kkandw, mycoachingtree, hospitalityonline];


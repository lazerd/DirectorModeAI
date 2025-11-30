'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Users, Trophy, Sparkles } from 'lucide-react';

interface FormatOption {
  id: string;
  name: string;
  description

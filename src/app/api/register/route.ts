import { handleRegister } from '@/lib/register.server';

export const runtime = 'nodejs';
export const POST = handleRegister;

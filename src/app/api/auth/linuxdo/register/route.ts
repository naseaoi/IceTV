export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export {
  getLinuxDoPending as GET,
  registerLinuxDo as POST,
} from '@/lib/linuxdo.server';

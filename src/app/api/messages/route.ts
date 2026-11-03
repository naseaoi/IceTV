import {
  handleGetMessages,
  handlePatchMessages,
} from '@/lib/messages-api.server';

export const runtime = 'nodejs';
export const GET = handleGetMessages;
export const PATCH = handlePatchMessages;

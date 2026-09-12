import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-lark',
  [
    'lib/types/index.js',
    'lib/types/auth-status.js',
    'lib/types/conversation.js',
    'lib/types/invariant.js',
    'lib/types/permissions.js',
    'lib/types/command-risk.js',
    'lib/types/pending-user-auth.js',
  ],
  { hostPhase: true },
)

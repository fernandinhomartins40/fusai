import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fusai/ui/components/card';
import { getMe } from '@/lib/session';
import { TwoFactorSetup } from './two-factor-setup';

/** Settings → "Segurança": the account's own authenticator app (optional for customers). */
export async function SecuritySection() {
  const me = await getMe();
  if (!me) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Segurança</CardTitle>
        <CardDescription>Verificação em duas etapas da sua conta.</CardDescription>
      </CardHeader>
      <CardContent>
        <TwoFactorSetup
          enabled={me.user.twoFactorEnabled}
          required={me.user.role === 'SUPER_ADMIN'}
        />
      </CardContent>
    </Card>
  );
}

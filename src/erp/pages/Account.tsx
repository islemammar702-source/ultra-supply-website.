import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Save } from 'lucide-react';
import { PageHeader, toast } from '@/admin/ui';
import { errMsg, sb, unwrap } from '../lib/db';
import { useAccess } from '../lib/access';
import { invalidate } from '../lib/hooks';
import { Field, KeyValues, Section, TextInput } from '../components/ui';

export default function AccountPage() {
  const { access, reload } = useAccess();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!access) return;
    setName(access.full_name);
    void sb().from('users').select('phone').eq('id', access.user_id).maybeSingle().then(({ data }: { data: unknown }) => setPhone((data as { phone: string | null } | null)?.phone ?? ''));
  }, [access]);

  const saveProfile = async () => {
    setBusy('profile');
    try {
      unwrap(await sb().from('users').update({ full_name: name.trim(), phone: phone.trim() || null }).eq('id', access!.user_id));
      invalidate('staff');
      await reload();
      toast('Profil mis à jour');
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(null); }
  };

  const changePassword = async () => {
    if (pwd.length < 10 || !/[a-z]/i.test(pwd) || !/\d/.test(pwd)) return toast('10 caractères minimum, avec des lettres et des chiffres.', 'err');
    if (pwd !== pwd2) return toast('Les deux mots de passe ne correspondent pas.', 'err');
    setBusy('pwd');
    try {
      const { error } = await sb().auth.updateUser({ password: pwd });
      if (error) throw new Error(error.message);
      setPwd(''); setPwd2('');
      toast('Mot de passe modifié');
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(null); }
  };

  if (!access) return null;
  return (
    <>
      <PageHeader title="Mon compte" subtitle={`${access.email} · ${access.role_label}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Profil">
          <div className="space-y-4 p-5">
            <Field label="Nom complet"><TextInput value={name} onChange={setName} /></Field>
            <Field label="Téléphone"><TextInput value={phone} onChange={setPhone} /></Field>
            <button className="btn btn-navy !min-h-[42px]" disabled={busy === 'profile'} onClick={saveProfile}>{busy === 'profile' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer</button>
          </div>
        </Section>
        <Section title="Mot de passe">
          <div className="space-y-4 p-5">
            <Field label="Nouveau mot de passe" hint="10 caractères minimum, avec des lettres et des chiffres."><TextInput type="password" value={pwd} onChange={setPwd} autoComplete="new-password" /></Field>
            <Field label="Confirmation"><TextInput type="password" value={pwd2} onChange={setPwd2} autoComplete="new-password" /></Field>
            <button className="btn btn-red !min-h-[42px]" disabled={busy === 'pwd' || !pwd} onClick={changePassword}>{busy === 'pwd' ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Changer le mot de passe</button>
          </div>
        </Section>
        <Section title="Mes droits" className="lg:col-span-2">
          <KeyValues items={[['Rôle', access.role_label], ['Permissions', access.role_id === 'super_admin' ? 'Toutes' : access.permissions.join(', ')]]} />
        </Section>
      </div>
    </>
  );
}

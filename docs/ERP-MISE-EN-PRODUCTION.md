# ULTRA SUPPLY — ERP / CRM : mise en production

L’espace `/admin` regroupe désormais l’administration du site **et** la gestion commerciale complète
(clients, devis, commandes, factures, avoirs, paiements, achats, stock, livraisons, demandes du site,
documents, rapports, utilisateurs et droits). Le site public n’est pas modifié, à l’exception
d’un champ « Type de demande » ajouté au formulaire de contact.

Le module de gestion fonctionne **uniquement avec la base Supabase** : aucune donnée n’est simulée.
Sans Supabase, le site reste en « mode démo » (site public + administration du contenu seulement).

---

## 1. Créer la base Supabase

1. Créez un projet sur <https://supabase.com> (région la plus proche : Europe, ex. Frankfurt).
2. **SQL Editor** → exécutez, dans cet ordre, le contenu de :
   1. `supabase/migrations/001_init.sql` — tables du site (catalogue, contenu, demandes)
   2. `supabase/seed.sql` — catalogue de départ (facultatif)
   3. `supabase/migrations/002_erp_core.sql` — tables ERP / CRM
   4. `supabase/migrations/003_erp_functions.sql` — règles métier (numérotation, totaux, stock, paiements…)
   5. `supabase/migrations/004_erp_security.sql` — sécurité (RLS, droits, stockage privé, journal)

   Les scripts 002 à 004 peuvent être relancés sans risque (idempotents).
3. **Authentication → Users → Add user** : créez votre compte (e-mail + mot de passe, « Auto confirm »).
4. Dans le SQL Editor, faites-en le super administrateur :
   ```sql
   select public.bootstrap_super_admin('votre-email@exemple.tn');
   ```
5. **Authentication → Providers → Email** : désactivez « Allow new users to sign up ».
   Les comptes du personnel se créent ensuite depuis `/admin/users`.

## 2. Variables d’environnement (Vercel → Settings → Environment Variables)

| Variable | Où la trouver | Visible du navigateur ? |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | oui (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase → API → `anon` `public` key | oui (public, protégée par RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → `service_role` key | **non — secret serveur** |
| `RESEND_API_KEY` | <https://resend.com> → API Keys | **non — secret serveur** |
| `MAIL_FROM` | ex. `ULTRA SUPPLY <factures@votre-domaine.tn>` (domaine vérifié dans Resend) | non |
| `MAIL_REPLY_TO` | ex. `ultrasupply.tn@gmail.com` | non |

Redéployez après avoir ajouté les variables. Ne préfixez **jamais** les clés secrètes par `VITE_` :
elles seraient incluses dans le code envoyé au navigateur.

Sans `RESEND_API_KEY`, le bouton « Envoyer par e-mail » télécharge le PDF et ouvre la messagerie
de l’utilisateur (pièce jointe à ajouter manuellement).

## 3. Rôles

| Rôle | Périmètre par défaut |
|---|---|
| Super administrateur | Tout, y compris la matrice des droits et les autres super administrateurs |
| Administrateur | Tout le fonctionnement courant, utilisateurs compris |
| Commercial | Clients, devis, commandes, factures brouillons, demandes du site |
| Comptable | Factures (validation, avoirs), paiements, factures fournisseurs, rapports, journal |
| Gestionnaire de stock | Produits, achats, réceptions, stock, livraisons |
| Employé | Consultation + demandes qui lui sont affectées |

Les droits se modifient dans **Rôles & droits** (super administrateur). Ils sont appliqués
**dans la base de données** (Row Level Security + fonctions vérifiant les permissions) :
masquer un bouton n’est jamais la seule protection.

## 4. Règles de gestion importantes

- **Numérotation** : `DEV-2026-0001`, `FAC-2026-0001`, `AV-…`, `BL-…`, `BCF-…`, `REC-…` (préfixes modifiables).
  Les factures reçoivent leur numéro **à la validation** uniquement : pas de trou dans la séquence.
- **Totaux** HT / TVA / TTC, remises et timbre fiscal sont **calculés par la base**, en décimal exact (3 décimales),
  jamais en virgule flottante.
- **Facture validée = non modifiable.** Toute correction passe par un **avoir** (total ou partiel) ;
  l’annulation d’une facture crée et valide automatiquement un avoir total. Chaque action est journalisée.
- **Paiements** : un paiement peut régler plusieurs factures (table `payment_allocations`) ; le reste non affecté
  constitue un acompte réutilisable. Le solde et le statut des factures (partiellement payée, payée, en retard)
  sont recalculés automatiquement.
- **Stock** : il ne bouge que par des opérations validées — réception fournisseur, validation de facture
  **ou** de bon de livraison (au choix dans Paramètres, pour éviter les doubles sorties), avoir, ajustement
  d’inventaire motivé. Coût moyen pondéré mis à jour à chaque réception (avec le taux de change de la commande).
- **Demandes du site** : les formulaires publics alimentent la boîte « Demandes du site » ; on peut les affecter,
  les suivre et les convertir en client puis en devis (lignes pré-remplies si le produit est reconnu).

## 5. Sécurité

- Row Level Security activée sur toutes les tables ; les visiteurs peuvent seulement **déposer** une demande.
- Les prix d’achat, prix de vente, stocks et notes internes ne sont **jamais** lisibles par les visiteurs
  (droits par colonne sur la table `products`).
- Documents (PDF, scans) dans un **bucket privé** `documents`, consultés via des liens temporaires (5 min).
  Types acceptés : PDF, JPG, PNG, WebP — 15 Mo maximum.
- La clé `service_role` n’est utilisée que par la fonction serveur `/api/admin-users`.
- Journal d’activité non modifiable (`activity_logs`) : création, modification (avant / après), suppression,
  validations, envois, connexions.

## 6. Sauvegardes

1. **Supabase** : sauvegardes quotidiennes automatiques sur les offres payantes (Pro : 7 jours) ;
   activez « Point in Time Recovery » pour pouvoir revenir à la minute près.
2. **Export régulier hors Supabase** (recommandé, au moins chaque semaine) :
   ```bash
   SUPABASE_DB_URL="postgresql://postgres:<mot-de-passe>@db.<ref>.supabase.co:5432/postgres" ./scripts/backup.sh
   ```
   Conservez les fichiers sur un stockage **privé** (disque chiffré, Drive privé…). Le dépôt GitHub étant
   public, n’y stockez jamais de sauvegarde ni de secret.
3. **Fichiers** (bucket `documents`) : téléchargez-les périodiquement depuis Supabase → Storage.
4. Testez une restauration une fois par trimestre sur un projet Supabase vide.

## 7. Tâche planifiée (facultatif)

Les statuts « en retard » et « expiré » sont recalculés à chaque ouverture du tableau de bord et des listes.
Pour un recalcul nocturne, activez l’extension `pg_cron` (Database → Extensions) puis :
```sql
select cron.schedule('ultra-supply-nightly', '15 1 * * *', $$
  update public.quotations set status = 'expired' where status = 'sent' and valid_until < current_date;
  select public.refresh_invoice_status(id) from public.invoices
   where kind = 'invoice' and status in ('validated','sent','partially_paid') and due_date < current_date and balance_due > 0;
$$);
```

## 8. Vérifications effectuées

- Migrations 001 → 004 appliquées sur PostgreSQL 16 avec un environnement Supabase simulé, puis rejouées (idempotence).
- 103 contrôles automatisés : numérotation, calculs, immuabilité des factures, avoirs, paiements multiples et partiels,
  acomptes, annulations, retards, stock (sorties, retours, réceptions partielles, coût moyen en devise, inventaire),
  droits par rôle (visiteur, commercial, comptable, magasinier, employé, administrateur), conversion des demandes,
  rapports et tableau de bord.
- PDF générés et contrôlés visuellement (facture multi-pages, reçu, bon de livraison).
- Fonctions serveur testées (refus sans authentification, sans permission, mot de passe faible, PDF invalide…).

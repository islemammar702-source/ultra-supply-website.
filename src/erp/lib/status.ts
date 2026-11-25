export type Tone = 'navy' | 'red' | 'gray' | 'green' | 'amber' | 'blue';

export interface StatusDef { label: string; tone: Tone }

export const QUOTATION_STATUS: Record<string, StatusDef> = {
  draft: { label: 'Brouillon', tone: 'gray' },
  sent: { label: 'Envoyé', tone: 'blue' },
  accepted: { label: 'Accepté', tone: 'green' },
  rejected: { label: 'Refusé', tone: 'red' },
  expired: { label: 'Expiré', tone: 'amber' },
};

export const INVOICE_STATUS: Record<string, StatusDef> = {
  draft: { label: 'Brouillon', tone: 'gray' },
  validated: { label: 'Validée', tone: 'navy' },
  sent: { label: 'Envoyée', tone: 'blue' },
  partially_paid: { label: 'Partiellement payée', tone: 'amber' },
  paid: { label: 'Payée', tone: 'green' },
  overdue: { label: 'En retard', tone: 'red' },
  cancelled: { label: 'Annulée', tone: 'gray' },
};

export const CREDIT_NOTE_STATUS: Record<string, StatusDef> = {
  draft: { label: 'Brouillon', tone: 'gray' },
  validated: { label: 'Validé', tone: 'navy' },
  sent: { label: 'Envoyé', tone: 'blue' },
};

export const ORDER_STATUS: Record<string, StatusDef> = {
  confirmed: { label: 'Confirmée', tone: 'navy' },
  in_progress: { label: 'En préparation', tone: 'blue' },
  delivered: { label: 'Livrée', tone: 'green' },
  invoiced: { label: 'Facturée', tone: 'green' },
  cancelled: { label: 'Annulée', tone: 'gray' },
};

export const PURCHASE_STATUS: Record<string, StatusDef> = {
  draft: { label: 'Brouillon', tone: 'gray' },
  sent: { label: 'Commandé', tone: 'blue' },
  partially_received: { label: 'Reçu partiellement', tone: 'amber' },
  received: { label: 'Reçu', tone: 'green' },
  cancelled: { label: 'Annulé', tone: 'gray' },
};

export const SUPPLIER_INVOICE_STATUS: Record<string, StatusDef> = {
  unpaid: { label: 'À payer', tone: 'red' },
  partially_paid: { label: 'Partiellement payée', tone: 'amber' },
  paid: { label: 'Payée', tone: 'green' },
  cancelled: { label: 'Annulée', tone: 'gray' },
};

export const DELIVERY_STATUS: Record<string, StatusDef> = {
  draft: { label: 'Brouillon', tone: 'gray' },
  validated: { label: 'Livré', tone: 'green' },
  cancelled: { label: 'Annulé', tone: 'gray' },
};

export const PAYMENT_STATUS: Record<string, StatusDef> = {
  valid: { label: 'Encaissé', tone: 'green' },
  cancelled: { label: 'Annulé', tone: 'gray' },
};

export const REQUEST_STATUS: Record<string, StatusDef> = {
  new: { label: 'Nouvelle', tone: 'red' },
  assigned: { label: 'Affectée', tone: 'blue' },
  in_progress: { label: 'En cours', tone: 'navy' },
  converted: { label: 'Convertie', tone: 'green' },
  closed: { label: 'Clôturée', tone: 'gray' },
  spam: { label: 'Indésirable', tone: 'gray' },
};

export const REQUEST_TYPE: Record<string, string> = {
  quote: 'Demande de devis',
  product_inquiry: 'Information produit',
  availability: 'Disponibilité',
  partnership: 'Partenariat',
  contact: 'Message de contact',
};

export const MOVEMENT_REASON: Record<string, string> = {
  opening: 'Stock initial',
  purchase_receipt: 'Réception fournisseur',
  sale_invoice: 'Facture client',
  credit_note: 'Avoir (retour)',
  delivery_note: 'Bon de livraison',
  manual_entry: 'Entrée manuelle',
  manual_exit: 'Sortie manuelle',
  inventory_adjustment: 'Ajustement d’inventaire',
  return: 'Retour / annulation',
};

export const ACTION_LABEL: Record<string, string> = {
  insert: 'Création', update: 'Modification', delete: 'Suppression',
  'auth.login': 'Connexion', 'auth.logout': 'Déconnexion',
  'invoice.validated': 'Facture validée', 'invoice.sent': 'Facture envoyée', 'invoice.cancelled': 'Facture annulée',
  'credit_note.created': 'Avoir créé', 'credit_note.validated': 'Avoir validé',
  'quotation.sent': 'Devis envoyé', 'quotation.accepted': 'Devis accepté', 'quotation.rejected': 'Devis refusé', 'quotation.draft': 'Devis rouvert',
  'quotation.converted_to_order': 'Devis → commande', 'quotation.converted_to_invoice': 'Devis → facture',
  'payment.recorded': 'Paiement enregistré', 'payment.allocated': 'Paiement affecté', 'payment.unallocated': 'Affectation retirée', 'payment.cancelled': 'Paiement annulé',
  'purchase_order.received': 'Réception marchandise', 'delivery_note.validated': 'Livraison validée', 'delivery_note.cancelled': 'Livraison annulée',
  'request.converted': 'Demande convertie', 'role.permissions_updated': 'Droits modifiés',
  'document.generated': 'PDF généré', 'document.uploaded': 'Document ajouté', 'email.sent': 'E-mail envoyé', 'export.csv': 'Export CSV',
};

export const ENTITY_LABEL: Record<string, string> = {
  users: 'Utilisateur', role_permissions: 'Droits', company_settings: 'Paramètres', vat_rates: 'TVA', payment_methods: 'Modes de paiement',
  numbering_rules: 'Numérotation', exchange_rates: 'Taux de change', customers: 'Client', suppliers: 'Fournisseur', brands: 'Marque',
  products: 'Produit', categories: 'Catégorie', contact_requests: 'Demande', quotations: 'Devis', orders: 'Commande', invoices: 'Facture',
  payments: 'Paiement', payment_allocations: 'Affectation', purchase_orders: 'Bon de commande', goods_receipts: 'Réception',
  supplier_invoices: 'Facture fournisseur', supplier_payments: 'Paiement fournisseur', delivery_notes: 'Bon de livraison', documents: 'Document',
  roles: 'Rôle',
};

export const MODULE_LABEL: Record<string, string> = {
  dashboard: 'Tableau de bord', customers: 'Clients', suppliers: 'Fournisseurs', products: 'Produits', quotations: 'Devis',
  orders: 'Commandes', invoices: 'Factures', payments: 'Paiements', purchases: 'Achats', inventory: 'Stock', deliveries: 'Livraisons',
  requests: 'Demandes du site', documents: 'Documents', reports: 'Rapports', users: 'Utilisateurs', settings: 'Paramètres',
  logs: 'Journal d’activité', website: 'Site public',
};

export const ACTION_PERM_LABEL: Record<string, string> = {
  view: 'Voir', create: 'Créer', edit: 'Modifier', delete: 'Supprimer', export: 'Exporter', validate: 'Valider', send: 'Envoyer',
  cancel: 'Annuler / avoir', receive: 'Réceptionner', adjust: 'Ajuster', assign: 'Affecter', manage: 'Gérer', view_costs: 'Voir les coûts',
};

export const CURRENCIES = ['TND', 'EUR', 'USD', 'GBP', 'TRY', 'CNY', 'CHF', 'JPY', 'AED', 'SAR'];
export const UNITS = ['pièce', 'kg', 'g', 't', 'm', 'm²', 'm³', 'L', 'lot', 'kit', 'boîte', 'carton', 'paire', 'jeu', 'rouleau', 'heure', 'jour', 'forfait'];

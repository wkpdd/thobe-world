/**
 * The shop's information pages. DEFAULT WORDING — the owner must read and
 * confirm every sentence (delays, exchange window, who pays the return).
 * Each block is [heading, paragraph | [list items]…]. {phone}, {address},
 * {instagram} and {name} are filled from the configuration.
 */
export const POLICIES = {
  'a-propos': {
    ar: { title: 'من نحن', blocks: [
      [null, '{name} متجر رجالي جزائري متخصص في القمصان (القميص)، الشاش، العطور والإكسسوارات.'],
      ['رسالتنا', 'تأنق كأنك ملك: قطع مختارة بعناية، أقمشة مريحة، وتوصيل إلى كل ولايات الوطن مع الدفع عند الاستلام.'],
      ['متجرنا', 'يسعدنا استقبالكم في محلنا: {address}.'],
    ] },
    fr: { title: 'Qui sommes-nous', blocks: [
      [null, '{name} est une boutique algérienne pour homme : qamis, chèches, parfums et accessoires.'],
      ['Notre promesse', 'Élégant comme un roi : des pièces choisies avec soin, des tissus agréables et la livraison dans toutes les wilayas, payée à la réception.'],
      ['La boutique', 'Venez nous voir : {address}.'],
    ] },
  },
  contact: {
    ar: { title: 'اتصل بنا', blocks: [
      [null, 'نحن هنا لمساعدتك في اختيار المقاس، تتبع طلبك أو أي سؤال آخر.'],
      [null, ['الهاتف وواتساب: {phone}', 'إنستغرام: @{instagram}', 'العنوان: {address}']],
    ] },
    fr: { title: 'Contact', blocks: [
      [null, 'Une question sur une taille, une commande ou un parfum ? Nous sommes là.'],
      [null, ['Téléphone et WhatsApp : {phone}', 'Instagram : @{instagram}', 'Adresse : {address}']],
    ] },
  },
  livraison: {
    ar: { title: 'التوصيل', blocks: [
      [null, 'نوصل إلى الولايات الـ 58 عبر شركات التوصيل نوست (Noest) وياليدين (Yalidine).'],
      ['الأسعار', 'يظهر سعر التوصيل حسب الولاية وطريقة الاستلام (إلى المنزل أو مكتب التوصيل) قبل تأكيد الطلب.'],
      ['المدة', 'من 24 إلى 72 ساعة عادة بعد تأكيد الطلب هاتفياً، وقد تزيد في الولايات البعيدة.'],
      ['الدفع', 'الدفع نقداً عند الاستلام. يمكنك فحص الطلب قبل الدفع.'],
    ] },
    fr: { title: 'Livraison', blocks: [
      [null, 'Nous livrons les 58 wilayas avec Noest et Yalidine.'],
      ['Tarifs', 'Le prix dépend de la wilaya et du mode (à domicile ou en point relais) ; il s’affiche avant la confirmation.'],
      ['Délais', 'Généralement 24 à 72 h après la confirmation téléphonique, davantage pour les wilayas du Sud.'],
      ['Paiement', 'En espèces à la livraison. Vous pouvez vérifier la commande avant de payer.'],
    ] },
  },
  echanges: {
    ar: { title: 'الاستبدال والإرجاع', blocks: [
      [null, 'يمكنك طلب تبديل المقاس أو اللون خلال 7 أيام من الاستلام.'],
      ['الشروط', ['القطعة بحالتها الأصلية، غير ملبوسة وغير مغسولة، مع غلافها.', 'العطور المفتوحة لا تُستبدل لأسباب صحية.', 'تكاليف توصيل التبديل على الزبون، إلا إذا كان الخطأ منا.']],
      ['كيف؟', 'راسلنا على واتساب {phone} مع رقم الطلب.'],
    ] },
    fr: { title: 'Échanges et retours', blocks: [
      [null, 'Vous pouvez échanger la taille ou la couleur sous 7 jours après la réception.'],
      ['Conditions', ['Article intact, non porté, non lavé, dans son emballage.', 'Les parfums ouverts ne sont pas échangés, par hygiène.', 'La livraison de l’échange est à votre charge, sauf erreur de notre part.']],
      ['Comment ?', 'Écrivez-nous sur WhatsApp au {phone} avec votre n° de commande.'],
    ] },
  },
  conditions: {
    ar: { title: 'شروط البيع', blocks: [
      [null, 'الأسعار بالدينار الجزائري وتشمل كل الرسوم، ما عدا التوصيل الذي يظهر قبل التأكيد.'],
      ['الطلب', 'يُعتبر الطلب نهائياً بعد تأكيده هاتفياً معك. قد نلغي طلباً إذا تعذّر الاتصال بك أو نفدت الكمية.'],
      ['الدفع', 'نقداً عند الاستلام لعامل التوصيل.'],
      ['البائع', '{name} — {address} — {phone}.'],
    ] },
    fr: { title: 'Conditions de vente', blocks: [
      [null, 'Prix en dinars algériens, toutes taxes comprises, hors livraison affichée avant la confirmation.'],
      ['Commande', 'La commande est ferme après confirmation par téléphone. Elle peut être annulée si nous ne vous joignons pas ou si l’article est épuisé.'],
      ['Paiement', 'En espèces au livreur, à la réception.'],
      ['Vendeur', '{name} — {address} — {phone}.'],
    ] },
  },
  confidentialite: {
    ar: { title: 'الخصوصية', blocks: [
      [null, 'نستعمل اسمك، رقم هاتفك وعنوانك فقط لتأكيد طلبك وتوصيله. نشاركها مع شركة التوصيل فقط.'],
      ['الإحصائيات', 'يحسب الموقع زياراته بنفسه دون ملفات تعريف (كوكيز) ودون حفظ عنوانك، ولا يرسلها لأي طرف. وقد نستعمل أدوات قياس (Meta، TikTok، Google) لتحسين إعلاناتنا.'],
      ['حقوقك', 'يمكنك طلب حذف معلوماتك بالاتصال بنا على {phone}.'],
    ] },
    fr: { title: 'Confidentialité', blocks: [
      [null, 'Votre nom, téléphone et adresse servent uniquement à confirmer et livrer votre commande, et ne sont partagés qu’avec le transporteur.'],
      ['Mesure d’audience', 'Le site compte ses visites lui-même, sans cookie et sans conserver votre adresse IP, et ne transmet ces chiffres à personne. Nous pouvons aussi utiliser des pixels (Meta, TikTok, Google) pour améliorer nos publicités.'],
      ['Vos droits', 'Demandez la suppression de vos données au {phone}.'],
    ] },
  },
};

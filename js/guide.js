// Informations contextuelles par opération, relevées le 8 novembre 2026.
// Elles sont indépendantes du carnet : une mise à jour ici profite aux carnets existants.
// Chaque bloc indique sa source et son niveau de fiabilité.

const VW = 'https://www.volkswagen.fr/fr/entretenir-ma-volkswagen/';
const S = {
  plan: { label: 'Volkswagen France, plan d’entretien', url: `${VW}entretien-et-pieces/plan-entretien.html` },
  fluides: { label: 'Volkswagen France, huile et fluides', url: `${VW}entretien-et-pieces/fluides-huile-moteur.html` },
  adblue: { label: 'Volkswagen France, AdBlue', url: `${VW}entretien-et-pieces/fluides-huile-moteur.html/__layer/layers/after_sales_4_0/service_and_parts/engine_oil_and_fluid/adblue/master.layer` },
  freins: { label: 'Volkswagen France, freins', url: `${VW}entretien-et-pieces/reparations-controles/freins.html` },
  fap: { label: 'Volkswagen France, voyant filtre à particules', url: `${VW}informations-client/voyants-et-temoins-lumineux/voyants-et-temoins-lumineux-vehicules-thermiques/filtre-a-particules.html` },
  clim: { label: 'Volkswagen France, climatisation et filtres', url: `${VW}entretien-et-pieces/reparations-controles/climatisation-et-filtre.html` },
  batterie: { label: 'Volkswagen France, batteries', url: `${VW}entretien-et-pieces/reparations-controles/batteries.html` },
  rappel: { label: 'Volkswagen France, campagne de rappel', url: `${VW}action-de-rappel/campagne-rappel-airbag-takata.html` },
  ct: { label: 'Service-public.gouv.fr, contrôle technique', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2878' },
  ad: { label: 'Guide AD, courroie du Touran', url: 'https://www.ad.fr/guides/guide-conseil/distribution/courroie-de-distribution-touran' },
  odopass: { label: 'Odopass, plan d’entretien Touran', url: 'https://www.odopass.fr/blog/plan-entretien-volkswagen-touran-programme-carnet-guide-complet' },
  fiches: { label: 'Fiches-Auto, fiabilité Touran', url: 'https://www.fiches-auto.fr/fiabilite-volkswagen/fiabilite-527-pannes-volkswagen-touran.php' },
};

const FILTRES_VW = {
  level: 'officiel',
  title: 'Ce que dit Volkswagen',
  items: [
    'Les filtres sont des pièces d’usure, à faire contrôler selon les intervalles d’entretien préconisés.',
    'Volkswagen ne publie pas d’intervalle chiffré pour ce filtre sur ses pages en ligne. Il figure dans le plan propre à ta voiture.',
  ],
  source: S.clim,
};

export const GUIDE = {
  service: {
    rhythmKm: 30000,
    sections: [
      {
        level: 'officiel',
        title: 'Intervalles Volkswagen',
        items: [
          'Entretien flexible : selon l’affichage du tableau de bord, au plus tard après 2 ans ou 30 000 km, au premier des deux termes.',
          'Entretien fixe : tous les 15 000 km, et au moins une fois par an.',
          'Le mode LongLife dépend du style de conduite, du type de parcours et du kilométrage. Volkswagen recommande par ailleurs une révision annuelle.',
          'L’échéance se vérifie dans le manuel, le Carnet de bord digital ou l’affichage des intervalles.',
        ],
        source: S.fluides,
      },
      {
        level: 'officiel',
        title: 'Vidange et huile',
        items: [
          'L’atelier remplace l’huile, le filtre à huile et les joints.',
          'LongLife IV FE concerne la nouvelle génération de moteurs essence et diesel, dont les diesels avec filtre à particules. LongLife III FE concerne les générations plus anciennes.',
          'Un filtre à huile obstrué peut réduire les performances, voire endommager le moteur.',
        ],
        source: S.fluides,
      },
      {
        level: 'officiel',
        title: 'Contrôles à chaque révision (1 an ou 15 000 km)',
        items: [
          'Niveaux de lave-glace et de liquide de frein.',
          'Épaisseur des plaquettes avant et arrière.',
          'Pneus : profondeur, aspect de la bande de roulement, pression, roue de secours comprise.',
          'Batterie, avertisseur sonore, état du pare-brise, éclairage avant et arrière.',
          'Test des systèmes au banc de diagnostic, remise à zéro de l’indicateur, autocollant sur le montant de porte conducteur.',
        ],
        source: S.plan,
      },
      {
        level: 'officiel',
        title: 'En plus à 2 ans ou 30 000 km',
        items: [
          'Antigel et niveau de liquide de refroidissement.',
          'Contrôle visuel du moteur et de son étanchéité.',
          'État et tension de la courroie multipiste.',
          'Gicleurs, plaques, clignotants, éclairages intérieurs et de coffre, feux de braquage, allumage automatique.',
          'Date limite du produit de colmatage des pneus.',
          'Filtre à particules à partir de 150 000 km, puis tous les 30 000 km.',
        ],
        source: S.plan,
      },
      {
        level: 'officiel',
        title: 'En plus à 4 ans ou 60 000 km',
        items: [
          'Contrôle visuel de la boîte, du couple réducteur et des soufflets.',
          'Freinage, échappement, réglage des phares, direction, rotules d’essieu.',
          'Protection du soubassement, toit ouvrant.',
          'Niveau d’huile de boîte automatique (ATF) et de pont arrière sur les 4 roues motrices.',
          'Parcours d’essai.',
        ],
        source: S.plan,
      },
      {
        level: 'officiel',
        title: 'Liquide de refroidissement',
        items: [
          'Le G12evo n’a normalement pas besoin d’être remplacé.',
          'Vérifie le niveau entre les révisions : un niveau insuffisant peut faire surchauffer le moteur et l’endommager gravement.',
        ],
        source: S.fluides,
      },
      {
        level: 'conseil',
        title: 'À demander au garage',
        items: [
          'Ma voiture est-elle en service fixe ou LongLife, et lequel me convient à ce kilométrage ?',
          'Quel est le plan officiel pour mon numéro de série, avec la date de chaque opération lourde ?',
          'Quelles opérations ont déjà été enregistrées dans le carnet numérique de la voiture ?',
          'Un devis écrit, détaillé par opération, avant les travaux.',
        ],
      },
    ],
  },

  ct: {
    sections: [
      {
        level: 'legal',
        title: 'Ce que dit la loi',
        items: [
          'Le premier contrôle se passe dans les 6 mois précédant le 4e anniversaire de la première mise en circulation.',
          'Il se renouvelle ensuite tous les 2 ans.',
          'En cas de défaillance majeure, la contre-visite doit être faite dans les 2 mois.',
          'Pour vendre une voiture de plus de 4 ans à un particulier, le contrôle doit avoir moins de 6 mois.',
        ],
        source: S.ct,
      },
      {
        level: 'officiel',
        title: 'Ce que dit Volkswagen',
        items: ['Le contrôle se fait dans un centre agréé par la préfecture de ton département.'],
        source: S.plan,
      },
    ],
  },

  rappels: {
    sections: [
      {
        level: 'officiel',
        title: 'Comment vérifier',
        items: [
          'Saisis le numéro de série à 17 caractères, case E de la carte grise, sur la page de campagne Volkswagen.',
          'Cette page concerne une campagne précise. Demande au garage de contrôler toutes les campagnes sur ton numéro de série.',
        ],
        source: S.rappel,
      },
      {
        level: 'conseil',
        title: 'Pourquoi tous les 6 mois',
        items: [
          'De nouvelles campagnes peuvent être ouvertes à tout moment, et un courrier peut ne pas arriver sur une voiture achetée d’occasion.',
          'Ce rythme est un choix de prudence, pas une consigne Volkswagen. Profite aussi de chaque passage au garage pour poser la question.',
        ],
      },
    ],
  },

  courroie: {
    sections: [
      {
        level: 'a-confirmer',
        title: 'Aucun chiffre officiel trouvé',
        items: [
          'Les pages publiques de Volkswagen France ne donnent pas d’intervalle de courroie.',
          'Seul le plan associé à ton numéro de série fait foi. Demande-le lors de ton prochain passage au garage.',
        ],
        source: S.plan,
      },
      {
        level: 'tiers',
        title: 'Ce que disent les autres sources',
        items: [
          'Guide AD : à partir de 210 000 km ou entre 8 et 10 ans pour le 2.0 TDI.',
          'Odopass, Touran depuis 2015 : en général entre 180 000 et 210 000 km ou 5 à 6 ans.',
          'L’échéance affichée ici utilise 210 000 km ou 8 ans. Une échéance plus précoce reste possible tant que le plan officiel n’est pas confirmé.',
        ],
        source: S.odopass,
      },
      {
        level: 'tiers',
        title: 'Coût, à titre de repère',
        items: [
          'Guide AD : 500 à 800 € pièces et main-d’œuvre.',
          'Odopass : 700 à 1 000 € selon le moteur.',
          'Pour une opération de ce montant, demande plusieurs devis.',
        ],
        source: S.ad,
      },
      {
        level: 'conseil',
        title: 'À demander au garage',
        items: [
          'Quel est l’intervalle officiel, en kilomètres et en années, pour mon moteur ?',
          'Le devis inclut-il le kit complet, galets et pompe à eau compris ?',
          'Y a-t-il une autre courroie à remplacer en même temps sur ce moteur ?',
        ],
      },
    ],
  },

  boite: {
    sections: [
      {
        level: 'officiel',
        title: 'Ce que dit Volkswagen',
        items: [
          'Le plan prévoit un contrôle visuel de la boîte et du niveau d’huile ATF à 4 ans ou 60 000 km.',
          'Les pages publiques ne donnent pas d’intervalle de vidange pour la boîte automatique.',
        ],
        source: S.plan,
      },
      {
        level: 'tiers',
        title: 'Ce que disent les autres sources',
        items: [
          'Odopass indique une vidange tous les 60 000 km sur les boîtes DSG à double embrayage humide, pour 250 à 400 €.',
          'Ce chiffre n’est pas confirmé par Volkswagen, et ne concerne pas les boîtes manuelles.',
        ],
        source: S.odopass,
      },
      {
        level: 'conseil',
        title: 'À demander au garage',
        items: [
          'Quel type de boîte équipe ma voiture ?',
          'La vidange a-t-elle été faite, et à quel kilométrage est-elle prévue ?',
        ],
      },
    ],
  },

  depollution: {
    sections: [
      {
        level: 'officiel',
        title: 'Filtre à particules',
        items: [
          'Le plan prévoit un contrôle à partir de 150 000 km, puis tous les 30 000 km.',
          'Voyant jaune : le filtre est colmaté par la suie et une régénération est nécessaire.',
          'Ne l’ignore pas : arrête-toi dès que possible en sécurité, puis suis la procédure du manuel ou du Carnet de bord digital.',
        ],
        source: S.fap,
      },
      {
        level: 'officiel',
        title: 'AdBlue',
        items: [
          'Consommation moyenne : 1,5 à 2,8 L aux 1 000 km selon la conduite et le modèle.',
          'Réservoir de 11 à 19 litres selon le modèle. Un témoin prévient à 2 400 km, puis à 1 000 km.',
          'Si le réservoir est vide, la voiture ne démarre pas. Elle redémarre après l’appoint.',
          'Utilise un produit conforme aux normes DIN 70070 et ISO 22241/1, sans aucun autre liquide ni antigel.',
          'En cas de débordement, nettoie vite à l’eau froide avec un chiffon humide, ou à l’eau chaude si le produit a cristallisé.',
          'Le niveau est contrôlé et complété à la révision.',
          'Si tu mets de l’AdBlue dans le réservoir de gazole, ne démarre surtout pas et appelle l’assistance Volkswagen.',
        ],
        source: S.adblue,
      },
      {
        level: 'tiers',
        title: 'Retours d’usagers',
        items: ['Des capteurs NOx ou injecteurs d’AdBlue défaillants peuvent déclencher un message antipollution.'],
        source: S.fiches,
      },
    ],
  },

  frein: {
    sections: [
      {
        level: 'officiel',
        title: 'Ce que dit Volkswagen',
        items: [
          'Volkswagen recommande un remplacement par un professionnel tous les deux ans.',
          'Il n’est pas obligatoire de le changer en même temps que les freins.',
          'Le niveau est contrôlé à chaque révision.',
        ],
        source: S.freins,
      },
      {
        level: 'conseil',
        title: 'À faire ici',
        items: ['Indique la date du dernier remplacement avec « Marquer comme fait » : l’échéance se calculera ensuite toute seule.'],
      },
    ],
  },

  habitacle: {
    sections: [
      FILTRES_VW,
      {
        level: 'officiel',
        title: 'Signes à surveiller',
        items: [
          'Odeurs désagréables, débit d’air faible, désembuage inefficace.',
          'Un filtre sale ne nettoie plus correctement l’air, et moisissures ou bactéries peuvent provoquer des odeurs.',
        ],
        source: S.clim,
      },
    ],
  },

  air: {
    sections: [
      FILTRES_VW,
      {
        level: 'officiel',
        title: 'Pourquoi le changer',
        items: ['Très obstrué, il peut réduire les performances et éventuellement augmenter la consommation.'],
        source: S.clim,
      },
    ],
  },

  gazole: {
    sections: [
      FILTRES_VW,
      {
        level: 'officiel',
        title: 'Pourquoi le changer',
        items: ['Il fonctionne comme un tamis et peut donc s’obstruer avec le temps.'],
        source: S.clim,
      },
    ],
  },

  freins: {
    sections: [
      {
        level: 'officiel',
        title: 'Ce que dit Volkswagen',
        items: [
          'Pas d’intervalle fixe : les freins se contrôlent aux révisions et se remplacent dès que nécessaire.',
          'L’épaisseur des plaquettes avant et arrière est mesurée à chaque révision.',
          'Le remplacement se fait en général dans la journée.',
          'Ce sont des pièces d’usure, non couvertes par la garantie.',
        ],
        source: S.freins,
      },
      {
        level: 'officiel',
        title: 'Signes d’alerte',
        items: [
          'Grincements, vibrations au freinage, distance de freinage plus longue.',
          'Un bruit peut venir d’un film de rouille sans gravité, de plaquettes usées ou d’un manque de liquide.',
          'Toute vibration au freinage peut indiquer un disque usé de manière inégale : contacte l’atelier sans attendre.',
          'Va à l’atelier au plus tard quand un témoin s’allume.',
        ],
        source: S.freins,
      },
    ],
  },

  pneus: {
    sections: [
      {
        level: 'officiel',
        title: 'Ce que dit Volkswagen',
        items: [
          'À chaque révision : profondeur des sculptures, aspect de la bande de roulement et pression, roue de secours comprise.',
          'À 2 ans ou 30 000 km : date limite du produit de colmatage, si la voiture en a un.',
          'Volkswagen propose des pneus été, hiver et toutes saisons.',
        ],
        source: S.plan,
      },
      {
        level: 'conseil',
        title: 'À noter ici',
        items: ['Note la date de montage et le kilométrage avec « Marquer comme fait », et la profondeur relevée par le garage en remarque.'],
      },
    ],
  },

  clim: {
    sections: [
      {
        level: 'officiel',
        title: 'Ce que dit Volkswagen',
        items: [
          'Volkswagen conseille de faire réviser la climatisation une fois par an.',
          'Le contrôle porte sur le fonctionnement, la température de sortie, et une inspection visuelle du compresseur, du condenseur et du détendeur.',
          'Une panne vient généralement d’un manque de gaz, d’un condenseur cassé, d’un compresseur défectueux ou d’une fuite de durite.',
        ],
        source: S.clim,
      },
    ],
  },

  batterie: {
    sections: [
      {
        level: 'officiel',
        title: 'Ce que dit Volkswagen',
        items: [
          'Le contrôle annuel est inclus dans la révision périodique.',
          'Avec Start/Stop automatique, la voiture utilise une batterie EFB, EFB+ ou AGM. Le type exact s’identifie par le numéro de série.',
          'Le système reconnaît la batterie par un code 2D. Une batterie inadaptée peut subir des charges inutiles ou trop se décharger.',
          'L’indicateur « œil magique » noir signifie que tout va bien. Jaune clair : va chez le réparateur.',
          'Ses ennemis sont les longues immobilisations et les petits trajets répétés.',
        ],
        source: S.batterie,
      },
      {
        level: 'officiel',
        title: 'Signes de défaut',
        items: ['Témoin allumé, démarrage difficile, boîtier endommagé, corrosion ou perte de liquide aux pôles.'],
        source: S.batterie,
      },
    ],
  },
};

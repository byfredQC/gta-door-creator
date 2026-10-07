// Language: English (source) / Français.
// The UI is written in English; in French every text node and title / placeholder is translated on the fly
// (exact strings + patterns for the texts built with numbers), new nodes included (MutationObserver).
// Switching back to English restores the original texts.

const FR = {
  // ---------------------------------------------------------------- top bar / home
  'GTA DOOR CREATOR': 'GTA DOOR CREATOR',
  '⌂ HOME': '⌂ ACCUEIL', 'Home': 'Accueil', 'File': 'Fichier', 'Settings': 'Paramètres', 'Settings…': 'Paramètres…',
  'Untitled project': 'Projet sans titre', '● Engine…': '● Moteur…', '● ENGINE READY': '● MOTEUR PRÊT', '● ENGINE ERROR': '● ERREUR MOTEUR',
  'DoorCore engine': 'Moteur DoorCore', 'DoorCore engine unavailable': 'Moteur DoorCore indisponible',
  'Doors, sounds, animations and destructible props for FiveM - no Blender, no script needed.': 'Portes, sons, animations et props destructibles pour FiveM - sans Blender, sans script.',
  'CREATE DOOR': 'CRÉER UNE PORTE', 'DOOR SOUND': 'SON DE PORTE', 'ANIMATION': 'ANIMATION', 'DESTRUCT': 'DESTRUCTION', 'DESTRUCTIBLE': 'DESTRUCTIBLE', '✓ DESTRUCTIBLE': '✓ DESTRUCTIBLE', 'TREE LOD': 'LOD ARBRES', 'TEXTURES': 'TEXTURES',
  'Normal, sliding or garage door. GTA native door (pushable), scripted with E, or animated .ycd.': 'Porte normale, coulissante ou de garage. Porte GTA native (poussable), scriptée avec E, ou animée .ycd.',
  'Give a GTA door sound to doors you already made. One small audio file, nothing else changes.': 'Donne un son de porte GTA à des portes déjà faites. Un petit fichier audio, rien d\'autre ne change.',
  'Make any prop move: logo spinning 360°, sign swinging, bobbing... loops by itself in-game.': 'Fais bouger n\'importe quel prop : logo qui tourne à 360°, panneau qui se balance... en boucle tout seul en jeu.',
  'Cut a prop (bridge, wall, sign) into pieces that break with explosions, vehicles and bullets.': 'Coupe un prop (pont, mur, panneau) en morceaux qui cassent avec les explosions, les véhicules et les balles.',
  'Your ymap of GTA trees seen from far away: LOD models + a _lod.ymap linked to your ymap, like GTA forests.': 'Les arbres GTA de ton ymap visibles de loin : modèles LOD + un _lod.ymap relié à ton ymap, comme les forêts de GTA.',
  'Type a prop or shell name: every texture it uses is exported as .dds (from your folder or GTA V).': 'Tape le nom d\'un prop ou d\'un shell : toutes ses textures sont exportées en .dds (depuis ton dossier ou GTA V).',
  'Open project…': 'Ouvrir un projet…', 'Continue to the editor →': 'Continuer vers l\'éditeur →',
  // ---------------------------------------------------------------- File menu
  'New Project': 'Nouveau projet', 'Open Project…': 'Ouvrir un projet…', 'Save Project': 'Enregistrer le projet', 'Save As…': 'Enregistrer sous…',
  'Import Prop…': 'Importer un prop…', 'Load sample door': 'Charger la porte d\'exemple', 'Load sample garage': 'Charger le garage d\'exemple',
  'Sound only (door already made)…': 'Son seulement (porte déjà faite)…', 'Create desktop shortcut': 'Créer un raccourci sur le bureau',
  // ---------------------------------------------------------------- page banners / steps
  'Hinged, sliding or garage door for your MLO / ymap.': 'Porte à charnière, coulissante ou de garage pour ton MLO / ymap.',
  'Make any prop move - it loops by itself in-game, no script.': 'Fais bouger n\'importe quel prop - il tourne en boucle tout seul en jeu, sans script.',
  'Cut a prop in pieces that break with explosions, cars and bullets - or play an explosion loop (.ycd).': 'Coupe un prop en morceaux qui cassent avec les explosions, les voitures et les balles - ou joue une explosion en boucle (.ycd).',
  'Import prop': 'Importer le prop', 'Create door': 'Créer la porte', 'Type & side': 'Type et côté', 'Preview': 'Aperçu', 'Export': 'Exporter',
  'Preset or keyframes': 'Préréglage ou clés', 'Pivot': 'Pivot', '▶ Preview': '▶ Aperçu', 'Pieces & strength': 'Morceaux et solidité', '💥 Preview break': '💥 Aperçu de la casse',
  'Import': 'Importer', 'Create': 'Créer', 'Type': 'Type', 'Configure': 'Configurer', 'YTYP': 'YTYP',
  // ---------------------------------------------------------------- prop / detect / create
  'PROP': 'PROP', 'Model': 'Modèle', 'Size': 'Taille', 'Vertices': 'Sommets', 'Materials': 'Matériaux', 'Collision': 'Collision',
  'DROP GTA PROP HERE': 'DÉPOSE UN PROP GTA ICI', '.ydr · .ydr.xml · .ytyp · .ybn · .ytd': '.ydr · .ydr.xml · .ytyp · .ybn · .ytd',
  'Drag a .ydr anywhere into the window': 'Glisse un .ydr n\'importe où dans la fenêtre', 'Release to import': 'Relâche pour importer', 'IMPORT PROP': 'IMPORTER UN PROP',
  'IMPORT PROP → CREATE DOOR → CHOOSE TYPE → LEFT/RIGHT → PREVIEW → GENERATE YTYP → EXPORT': 'IMPORTER → CRÉER LA PORTE → TYPE → GAUCHE/DROITE → APERÇU → GÉNÉRER LE YTYP → EXPORTER',
  'AUTO DETECT': 'DÉTECTION AUTO', 'Likely Door Type': 'Type de porte probable', 'Suggested Pivot': 'Pivot suggéré', 'Suggested Opening': 'Ouverture suggérée',
  'Door width': 'Largeur de la porte', 'ACCEPT SUGGESTION': 'ACCEPTER LA SUGGESTION', 'RE-RUN': 'RELANCER', 'Prop analysed': 'Prop analysé',
  'Normal Door': 'Porte normale', 'Sliding Door': 'Porte coulissante', 'Garage Door': 'Porte de garage', 'Suggestion applied': 'Suggestion appliquée',
  // ---------------------------------------------------------------- door type
  'DOOR TYPE': 'TYPE DE PORTE', 'NORMAL DOOR': 'PORTE NORMALE', 'SLIDING DOOR': 'PORTE COULISSANTE', 'GARAGE DOOR': 'PORTE DE GARAGE', 'CUSTOM ANIM': 'ANIM CUSTOM', 'Destructible': 'Destructible',
  'Direction (hinge side)': 'Direction (côté charnière)', 'Direction': 'Direction', '← LEFT': '← GAUCHE', 'RIGHT →': 'DROITE →', '↑ UP': '↑ HAUT', '↓ DOWN': '↓ BAS', '◧ LEFT': '◧ GAUCHE', 'RIGHT ◨': 'DROITE ◨',
  'LEFT': 'GAUCHE', 'RIGHT': 'DROITE', '⇄ FLIP': '⇄ INVERSER', 'Opens toward −Y (push)': 'S\'ouvre vers −Y (pousser)',
  'Opening Angle': 'Angle d\'ouverture', 'Opening Distance': 'Distance d\'ouverture', 'Opening Height': 'Hauteur d\'ouverture', 'Opening Speed': 'Vitesse d\'ouverture', 'Slide Distance': 'Distance de glissement',
  'SLOW': 'LENT', 'NORMAL': 'NORMAL', 'FAST': 'RAPIDE', 'Slow': 'Lent', 'Normal': 'Normal', 'Fast': 'Rapide',
  'In-game behaviour': 'Comportement en jeu', 'NATIVE': 'NATIVE', 'SCRIPTED': 'SCRIPTÉE', 'ANIMATED .YCD': 'ANIMÉE .YCD',
  'Garage Type': 'Type de garage', 'GARAGE SLIDING': 'GARAGE COULISSANT', 'GARAGE ROLL UP': 'GARAGE À ENROULEMENT', 'GARAGE SECTIONAL': 'GARAGE SECTIONNEL',
  'Garage sliding': 'Garage coulissant', 'Garage roll up': 'Garage à enroulement', 'Garage sectional': 'Garage sectionnel', 'Breaks in pieces': 'Se casse en morceaux', 'Loop (auto, no script)': 'Boucle (auto, sans script)',
  'Panel Count': 'Nombre de panneaux', 'Panel Size': 'Taille des panneaux', 'Preview the in-game motion': 'Aperçu du mouvement en jeu',
  'SCRIPTED: the export adds client/server Lua that plays exactly this preview (angle, distance, speed), synced for every player (E in-game).': 'SCRIPTÉE : l\'export ajoute un Lua client/serveur qui joue exactement cet aperçu (angle, distance, vitesse), synchronisé pour tous les joueurs (E en jeu).',
  'NATIVE (default, no script): GTA door system - a physics door players push open. Collision is embedded in the .ydr. Angle & speed only apply in SCRIPTED mode.': 'NATIVE (par défaut, sans script) : système de portes GTA - une porte physique que les joueurs poussent. La collision est dans le .ydr. Angle et vitesse ne s\'appliquent qu\'en mode SCRIPTÉE.',
  'ANIMATED .YCD: the export makes a GTA animated fragment (.yft) + its open/close clips (.ycd) + an expression (.yed) so the COLLISION FOLLOWS the animation. A small Lua plays the clips with E, synced for every player. No GTA door sound in this mode.': 'ANIMÉE .YCD : l\'export crée un fragment animé GTA (.yft) + ses clips ouvrir/fermer (.ycd) + une expression (.yed) pour que la COLLISION SUIVE l\'animation. Un petit Lua joue les clips avec E, synchronisé pour tous. Pas de son de porte GTA dans ce mode.',
  'GTA vertical sliding door (specialAttribute 10, like vanilla shutters): the door system lifts it. Height & speed are decided by the game - use SCRIPTED for exact values.': 'Porte coulissante verticale GTA (specialAttribute 10, comme les rideaux vanilla) : le système de portes la lève. Hauteur et vitesse décidées par le jeu - utilise SCRIPTÉE pour des valeurs exactes.',
  'GTA garage door (specialAttribute 5): the door system moves it (usually opened by a script or door lock resource). Use SCRIPTED to get this exact motion.': 'Porte de garage GTA (specialAttribute 5) : le système de portes la bouge (souvent ouverte par un script ou une ressource de verrouillage). Utilise SCRIPTÉE pour ce mouvement exact.',
  // ---------------------------------------------------------------- door settings / pivot / collision / sound
  'DOOR SETTINGS': 'RÉGLAGES DE LA PORTE', 'Model Name': 'Nom du modèle', 'Archetype Name': 'Nom de l\'archétype', 'APPLY': 'APPLIQUER', 'Door settings applied': 'Réglages de la porte appliqués',
  'PIVOT': 'PIVOT', '✦ AUTO PIVOT': '✦ PIVOT AUTO', 'CENTER': 'CENTRE', 'Center': 'Centre', 'GIZMO': 'GIZMO',
  'Pivot = new model origin. The geometry is only offset on export; your source file is never modified.': 'Pivot = nouvelle origine du modèle. La géométrie n\'est décalée qu\'à l\'export ; ton fichier source n\'est jamais modifié.',
  'COLLISION': 'COLLISION', 'NO COLLISION': 'SANS COLLISION', 'AUTO COLLISION': 'COLLISION AUTO', 'IMPORT YBN': 'IMPORTER UN YBN', 'KEEP EMBEDDED': 'GARDER L\'INTÉGRÉE', 'Keep embedded': 'Garder l\'intégrée',
  'BOX': 'BOÎTE', 'CONVEX': 'CONVEXE', 'Material': 'Matériau', 'Choose .ybn…': 'Choisir un .ybn…', 'Import YBN': 'Importer un YBN',
  'Model has no embedded collision.': 'Le modèle n\'a pas de collision intégrée.', 'Choose a .ybn file.': 'Choisis un fichier .ybn.',
  'Sound': 'Son', 'The door will use no sound.': 'La porte n\'aura pas de son.', 'Hinged doors': 'Portes à charnière', 'Sliding doors': 'Portes coulissantes',
  'Shutters / vertical': 'Rideaux / verticales', 'Garage doors': 'Portes de garage', 'Barriers': 'Barrières', 'AUTO (recommended)': 'AUTO (recommandé)', 'No sound': 'Pas de son',
  'Uses GTA\'s own door sounds: the export adds a small audio file (game.dat151) that links your door to the chosen sound. Heard in-game only.': 'Utilise les sons de portes de GTA : l\'export ajoute un petit fichier audio (game.dat151) qui relie ta porte au son choisi. Audible en jeu seulement.',
  '(default for this door type)': '(par défaut pour ce type de porte)',
  'PRESETS': 'PRÉRÉGLAGES', 'Presets': 'Préréglages', 'SAVE PRESET': 'ENREGISTRER LE PRÉRÉGLAGE', 'Save preset': 'Enregistrer le préréglage', 'Preset name': 'Nom du préréglage', 'delete': 'supprimer',
  'Normal Door 90°': 'Porte normale 90°', 'Normal Door 180°': 'Porte normale 180°', 'Garage Roll Up': 'Garage à enroulement', 'Garage Sectional': 'Garage sectionnel',
  'hinged · native · no script': 'charnière · native · sans script', 'scripted (needs Lua)': 'scriptée (Lua nécessaire)', 'native sliding · no script': 'coulissante native · sans script',
  'native lift · no script': 'levage natif · sans script', 'native shutter · no script': 'rideau natif · sans script', 'native garage · no script': 'garage natif · sans script',
  // ---------------------------------------------------------------- viewer / preview
  'PERSP': 'PERSP', 'FRONT': 'FACE', 'SIDE': 'CÔTÉ', 'TOP': 'DESSUS', 'WIREFRAME': 'FILAIRE', 'SOLID': 'SOLIDE', 'MATERIAL': 'MATÉRIAU', 'GRID': 'GRILLE', 'COLL': 'COLL', 'GHOST': 'FANTÔME',
  'LMB orbit · RMB / Shift pan · Wheel zoom · F frame · 1/3/7/5 views': 'Clic G orbite · Clic D / Maj déplacer · Molette zoom · F cadrer · 1/3/7/5 vues',
  'DOOR PREVIEW': 'APERÇU DE LA PORTE', 'ANIMATION PREVIEW': 'APERÇU DE L\'ANIMATION', 'BREAK PREVIEW': 'APERÇU DE LA CASSE', 'CLOSED': 'FERMÉE', 'OPEN': 'OUVERTE', 'LOOP': 'BOUCLE',
  'press CREATE DOOR': 'clique sur CRÉER UNE PORTE', 'pivot · origin · animation · YTYP': 'pivot · origine · animation · YTYP',
  // ---------------------------------------------------------------- ytyp panel / export
  'YTYP PREVIEW': 'APERÇU YTYP', 'SUMMARY': 'RÉSUMÉ', 'XML': 'XML', 'FXMANIFEST': 'FXMANIFEST', '⧉ COPY': '⧉ COPIER', '⧉ COPY FXMANIFEST': '⧉ COPIER FXMANIFEST',
  'Name': 'Nom', 'Bounds': 'Limites', 'Radius': 'Rayon', 'Min': 'Min', 'Max': 'Max', 'Flags': 'Flags', 'LOD Distance': 'Distance LOD', 'HD LOD Distance': 'Distance LOD HD', 'Texture Dict': 'Dict. de textures', 'YTYP File': 'Fichier YTYP',
  'GENERATE YTYP': 'GÉNÉRER LE YTYP', 'Generate YTYP': 'Générer le YTYP', 'not generated': 'non généré', 'Create a door to see its archetype.': 'Crée une porte pour voir son archétype.',
  'EXPORT': 'EXPORT', 'No output folder': 'Pas de dossier de sortie', 'CHOOSE…': 'CHOISIR…', 'Choose…': 'Choisir…', 'NEW FILE': 'NOUVEAU FICHIER', 'MY .YTYP…': 'MON .YTYP…', 'CHANGE': 'CHANGER',
  'EXPORT YDR': 'EXPORTER YDR', 'EXPORT YTYP': 'EXPORTER YTYP', 'EXPORT YBN': 'EXPORTER YBN', 'EXPORT ALL': 'TOUT EXPORTER', 'EXPORT YFT': 'EXPORTER YFT', 'EXPORT YFT+YCD': 'EXPORTER YFT+YCD',
  'EXPORT FIVEM RESOURCE': 'EXPORTER LA RESSOURCE FIVEM', 'my_door/ stream/ · fxmanifest.lua': 'my_door/ stream/ · fxmanifest.lua',
  'Include Lua script': 'Inclure le script Lua', '(off = native GTA door, no script)': '(non = porte GTA native, sans script)', 'Also stream the standalone .ybn': 'Streamer aussi le .ybn séparé', '(see note)': '(voir la note)',
  'Export YDR': 'Export YDR', 'Export YTYP': 'Export YTYP', 'Export YBN': 'Export YBN', 'Export all (collision embedded in the .ydr)': 'Tout exporter (collision intégrée au .ydr)',
  'Choose the export folder': 'Choisis le dossier d\'export', 'Where should the FiveM resource folder be created?': 'Où créer le dossier de la ressource FiveM ?',
  'Resource exists': 'La ressource existe', 'Overwrite its files?': 'Écraser ses fichiers ?', 'Overwrite': 'Écraser', 'Cancel': 'Annuler', 'Close': 'Fermer', 'OK': 'OK',
  'FiveM resource ready': 'Ressource FiveM prête', 'was created in': 'a été créé dans', 'to server.cfg and place': 'dans server.cfg et place', 'in your ymap / MLO.': 'dans ton ymap / MLO.', 'Add': 'Ajoute',
  'Create a door first': 'Crée d\'abord une porte', 'Import a prop first': 'Importe d\'abord un prop', 'No door in the editor': 'Pas de porte dans l\'éditeur',
  'Stream the .ybn?': 'Streamer le .ybn ?', 'Keep off': 'Laisser désactivé', 'Stream it anyway': 'Le streamer quand même',
  'fxmanifest.lua lines copied - paste them in your resource (Ctrl+V)': 'Lignes fxmanifest.lua copiées - colle-les dans ta ressource (Ctrl+V)',
  'Destruct animation (.ycd)': 'Animation de destruction (.ycd)', 'Destructible fragment': 'Fragment destructible', 'Animated fragment (.ycd)': 'Fragment animé (.ycd)', 'Animated fragment': 'Fragment animé',
  ' (auto start, loops - no script)': ' (démarre tout seul, en boucle - sans script)',
  '  ⧉ Click "COPY FXMANIFEST" (YTYP PREVIEW) to get the lines for your fxmanifest.lua': '  ⧉ Clique sur « COPIER FXMANIFEST » (APERÇU YTYP) pour avoir les lignes de ton fxmanifest.lua',
  '  ⧉ Put these 4 files in stream/ and use EXPORT FIVEM RESOURCE for the Lua that plays the clips': '  ⧉ Mets ces 4 fichiers dans stream/ et utilise EXPORTER LA RESSOURCE FIVEM pour le Lua qui joue les clips',
  '  ⧉ Put these 4 files in stream/ + the data_file line (COPY FXMANIFEST): the animation loops by itself, no script': '  ⧉ Mets ces 4 fichiers dans stream/ + la ligne data_file (COPIER FXMANIFEST) : l\'animation tourne en boucle toute seule, sans script',
  '  ⧉ Put these 4 files in stream/ + the data_file line (COPY FXMANIFEST): the explosion loops by itself, no script': '  ⧉ Mets ces 4 fichiers dans stream/ + la ligne data_file (COPIER FXMANIFEST) : l\'explosion tourne en boucle toute seule, sans script',
  '  ⧉ Put the .yft + .ytyp in stream/ + the data_file line (COPY FXMANIFEST): it breaks by itself, no script': '  ⧉ Mets le .yft + .ytyp dans stream/ + la ligne data_file (COPIER FXMANIFEST) : il casse tout seul, sans script',
  '  ✓ collision follows the animation (fragment + expression)': '  ✓ la collision suit l\'animation (fragment + expression)',
  'No-script resource: switched to NATIVE DOOR (the GTA door system moves it)': 'Ressource sans script : passage en PORTE NATIVE (le système de portes GTA la bouge)',
  'Add the archetype to your own .ytyp (for example the ytyp of your MLO)': 'Ajoute l\'archétype dans ton propre .ytyp (par exemple le ytyp de ton MLO)', 'Create a new .ytyp for this prop': 'Crée un nouveau .ytyp pour ce prop',
  // ---------------------------------------------------------------- custom animation
  'Custom animation': 'Animation custom', 'CUSTOM ANIMATION': 'ANIMATION CUSTOM', 'Custom': 'Custom', 'Keyframes': 'Clés', 'Interpolation': 'Interpolation', 'LINEAR': 'LINÉAIRE', 'SMOOTH': 'DOUCE',
  'SPIN 360° Z': 'TOUR 360° Z', 'SPIN 360° X': 'TOUR 360° X', 'SPIN 360° Y': 'TOUR 360° Y', 'SWING ±30°': 'BALANCIER ±30°', 'BOB UP/DOWN': 'MONTE/DESCEND', 'SPIN + BOB': 'TOUR + MONTE',
  '+ ADD KEY': '+ AJOUTER UNE CLÉ', '+ KEY AT PREVIEW': '+ CLÉ À L\'APERÇU', 'TIME s': 'TEMPS s', 'ROT X°': 'ROT X°', 'ROT Y°': 'ROT Y°', 'ROT Z°': 'ROT Z°', 'MOVE X': 'DÉPL X', 'MOVE Y': 'DÉPL Y', 'MOVE Z': 'DÉPL Z',
  'In-game it starts and loops by itself - ': 'En jeu elle démarre et tourne en boucle toute seule - ', 'no script': 'sans script', ' - and the collision turns with it.': ' - et la collision tourne avec.',
  'Constant speed - best for spins': 'Vitesse constante - idéal pour les rotations', 'Slows down at every key - best for swings': 'Ralentit à chaque clé - idéal pour les balanciers',
  'Add a key at the preview slider position': 'Ajoute une clé à la position du curseur d\'aperçu', 'Delete this key': 'Supprimer cette clé',
  'ANIMATION: pick a preset or edit the keyframes, then EXPORT FIVEM RESOURCE': 'ANIMATION : choisis un préréglage ou modifie les clés, puis EXPORTER LA RESSOURCE FIVEM',
  'Any prop: a logo that spins, a sign that swings... loops by itself in-game (no script)': 'N\'importe quel prop : un logo qui tourne, un panneau qui se balance... en boucle tout seul en jeu (sans script)',
  // ---------------------------------------------------------------- destruct
  'Pieces': 'Morceaux', '↻ NEW CUT': '↻ NOUVELLE DÉCOUPE', '💥 PREVIEW BREAK': '💥 APERÇU DE LA CASSE', 'How it breaks': 'Comment ça casse', 'PHYSICS': 'PHYSIQUE', '.YCD ANIMATION': 'ANIMATION .YCD',
  'Strength': 'Solidité', '(force needed to break a piece)': '(force nécessaire pour casser un morceau)', 'FRAGILE': 'FRAGILE', 'VERY SOLID': 'TRÈS SOLIDE',
  'Anchored': 'Ancré', '(stays in place until it breaks - bridges, walls)': '(reste en place jusqu\'à ce qu\'il casse - ponts, murs)',
  'Explosion force': 'Force de l\'explosion', 'LIGHT': 'LÉGÈRE', 'STRONG': 'FORTE', 'HUGE': 'ÉNORME', 'Intact': 'Intact', '(before it explodes)': '(avant l\'explosion)',
  'On the ground': 'Au sol', 'Rebuild': 'Reconstruction', '(pieces fly back)': '(les morceaux reviennent)', 'Collision of the pieces': 'Collision des morceaux', 'REAL SHAPE': 'VRAIE FORME', 'BOXES': 'BOÎTES',
  'Cut the model in a different way': 'Couper le modèle autrement', 'Play the break': 'Jouer la casse',
  '50 - breaks with bullets / bumps': '50 - casse avec les balles / chocs', '300 - breaks with cars and explosions': '300 - casse avec les voitures et les explosions',
  '1500 - needs a big explosion or a heavy vehicle': '1500 - il faut une grosse explosion ou un véhicule lourd', '5000 - only very big hits': '5000 - seulement les très gros chocs',
  'Real GTA physics: explosions, cars and bullets break the pieces off': 'Vraie physique GTA : explosions, voitures et balles détachent les morceaux',
  'An explosion animation (.ycd) that loops by itself: intact, explodes, lies on the ground, rebuilds - no script': 'Une animation d\'explosion (.ycd) en boucle : intact, explose, reste au sol, se reconstruit - sans script',
  'Each piece collides with its real shape - a bridge deck stays walkable at the right height': 'Chaque morceau a sa vraie forme - un tablier de pont reste praticable à la bonne hauteur',
  'One box per piece - lighter, but boxes can stick out (e.g. above railings)': 'Une boîte par morceau - plus léger, mais les boîtes peuvent dépasser (ex. au-dessus des rambardes)',
  'Breaks into pieces in-game (explosions, impacts, bullets) with real GTA physics - no script': 'Se casse en morceaux en jeu (explosions, chocs, balles) avec la vraie physique GTA - sans script',
  'DESTRUCT: choose the number of pieces, then EXPORT FIVEM RESOURCE': 'DESTRUCTION : choisis le nombre de morceaux, puis EXPORTER LA RESSOURCE FIVEM',
  'computing the explosion… ': 'calcul de l\'explosion… ', 'Cutting… · ': 'Découpe… · ', 'Explosion preview failed: ': 'Aperçu de l\'explosion impossible : ', 'Cut failed: ': 'Découpe impossible : ',
  'intact': 'intact', 'explosion': 'explosion', 'on the ground': 'au sol', 'rebuild': 'reconstruction', 'computing…': 'calcul…',
  // ---------------------------------------------------------------- sound only
  '♪ SOUND ONLY': '♪ SON SEULEMENT', 'door already made': 'porte déjà faite', '♪ SOUND ONLY - door already made': '♪ SON SEULEMENT - porte déjà faite',
  'Adds a GTA door sound to doors that are already in your resource. Nothing else is changed: no .ydr / .ytyp export.': 'Ajoute un son de porte GTA à des portes déjà dans ta ressource. Rien d\'autre ne change : pas d\'export .ydr / .ytyp.',
  'Door model names': 'Noms des modèles de portes', '(one per line - the archetype name used in your ytyp)': '(un par ligne - le nom d\'archétype utilisé dans ton ytyp)',
  'From a .ytyp…': 'Depuis un .ytyp…', 'Current door': 'Porte actuelle', 'Audio file name': 'Nom du fichier audio', 'fxmanifest.lua lines': 'Lignes fxmanifest.lua', 'CREATE AUDIO FILE': 'CRÉER LE FICHIER AUDIO',
  'Add a GTA door sound to a door you already made (no model needed)': 'Ajoute un son de porte GTA à une porte déjà faite (pas besoin du modèle)',
  '-- type at least one door model name': '-- tape au moins un nom de modèle de porte', 'Choose a .ytyp file': 'Choisis un fichier .ytyp',
  // ---------------------------------------------------------------- settings / uninstall
  'SETTINGS': 'PARAMÈTRES', 'Version': 'Version', 'Program folder': 'Dossier du programme', 'Settings & presets': 'Paramètres et préréglages', 'Desktop shortcut': 'Raccourci bureau',
  'Open': 'Ouvrir', 'Language': 'Langue', 'Uninstall GTA Door Creator': 'Désinstaller GTA Door Creator', 'UNINSTALL…': 'DÉSINSTALLER…', 'Uninstall': 'Désinstaller',
  'Also delete my settings and presets': 'Supprimer aussi mes paramètres et préréglages',
  'Installed version - the Windows uninstaller will open.': 'Version installée - le désinstalleur Windows va s\'ouvrir.',
  'Portable / zip version - nothing is installed: just delete the folder.': 'Version portable / zip - rien n\'est installé : supprime simplement le dossier.',
  'Unsaved project': 'Projet non enregistré', 'Your project has unsaved changes. Uninstall anyway?': 'Ton projet a des modifications non enregistrées. Désinstaller quand même ?',
  'Uninstall GTA Door Creator?': 'Désinstaller GTA Door Creator ?', 'The app will close and the Windows uninstaller will open.': 'L\'app va se fermer et le désinstalleur Windows va s\'ouvrir.',
  'Your exported resources and .doorproject files are not touched.': 'Tes ressources exportées et tes fichiers .doorproject ne sont pas touchés.',
  'Uninstaller not found - delete the program folder by hand': 'Désinstalleur introuvable - supprime le dossier du programme à la main',
  'Desktop shortcut created': 'Raccourci bureau créé', 'Could not create the shortcut': 'Impossible de créer le raccourci',
  'New project': 'Nouveau projet', 'Discard the current unsaved door?': 'Abandonner la porte actuelle non enregistrée ?', 'Nothing to save yet - import a prop first': 'Rien à enregistrer - importe d\'abord un prop',
  'Not a .doorproject file': 'Ce n\'est pas un fichier .doorproject', 'Could not open project: ': 'Impossible d\'ouvrir le projet : ',
  'Standalone door builder for GTA V / FiveM mappers.': 'Créateur de portes autonome pour les mappeurs GTA V / FiveM.',
  'YTYP read. Now drop the matching .ydr to build the door.': 'YTYP lu. Dépose maintenant le .ydr correspondant pour créer la porte.',
  'Textures are in an external .ytd - drop it to see them in Material Preview, and set its name in YTYP › Texture Dict.': 'Les textures sont dans un .ytd externe - dépose-le pour les voir en aperçu Matériau, et mets son nom dans YTYP › Dict. de textures.',
  // ---------------------------------------------------------------- titles (tooltips)
  'Frame model (F)': 'Cadrer le modèle (F)', 'Front (1)': 'Face (1)', 'Side (3)': 'Côté (3)', 'Top (7)': 'Dessus (7)', 'Perspective (5)': 'Perspective (5)', 'Grid (G)': 'Grille (G)', 'Wireframe (Z)': 'Filaire (Z)',
  'Solid': 'Solide', 'Material preview': 'Aperçu matériau', 'Show collision (C)': 'Afficher la collision (C)', 'Show closed position ghost': 'Afficher le fantôme fermé', 'Move the pivot with the 3D gizmo': 'Déplacer le pivot avec le gizmo 3D',
  'Play (Space)': 'Lecture (Espace)', 'Pause': 'Pause', 'Stop': 'Stop', 'Reset': 'Réinitialiser', 'Reverse the swing direction': 'Inverser le sens d\'ouverture',
  'Detect the hinge side and place the pivot on the edge': 'Détecter le côté charnière et placer le pivot sur le bord', 'Use recommended flags for this door': 'Utiliser les flags recommandés pour cette porte',
  'Copy the lines to paste in your fxmanifest.lua': 'Copier les lignes à coller dans ton fxmanifest.lua',
  'GTA door system: pushable physics door (doortuning)': 'Système de portes GTA : porte physique poussable (doortuning)', 'Animated by the generated Lua exactly like the preview': 'Animée par le Lua généré exactement comme l\'aperçu',
  'GTA animation: .yft fragment + .ycd clips + .yed - the collision follows the animation': 'Animation GTA : fragment .yft + clips .ycd + .yed - la collision suit l\'animation',
  // ---------------------------------------------------------------- TREE LOD
  'Trees of your ymap visible from far away: the app makes a light LOD model per tree type (its own lowest detail level), a': 'Les arbres de ton ymap visibles de loin : l\'app crée un modèle LOD léger par type d\'arbre (son niveau de détail le plus bas), un',
  'with one LOD per tree and links your ymap to it - the chain GTA uses for its forests.': 'avec un LOD par arbre, et relie ton ymap dessus - la chaîne que GTA utilise pour ses forêts.',
  'GTA V folder': 'Dossier GTA V', 'Your ymap': 'Ton ymap', 'Pick the trees': 'Choisir les arbres', 'Generate': 'Générer',
  '1 · GTA V FOLDER': '1 · DOSSIER GTA V', 'read only - nothing is changed in it': 'lecture seule - rien n\'y est modifié', 'Find it': 'Le trouver',
  'Legacy': 'Legacy', '(the one FiveM uses). The models of your trees are read from it, the LOD keeps using GTA\'s own textures.': '(celle que FiveM utilise). Les modèles de tes arbres y sont lus, le LOD garde les textures de GTA.',
  '2 · YOUR YMAP': '2 · TON YMAP', 'Drop your .ymap here': 'Dépose ton .ymap ici', 'or click to choose (.ymap or .ymap.xml)': 'ou clique pour choisir (.ymap ou .ymap.xml)',
  '4 · DISTANCES': '4 · DISTANCES', 'Tree → LOD switch': 'Passage arbre → LOD', '(AUTO = each tree\'s own GTA distance)': '(AUTO = la distance GTA de chaque arbre)', 'LOD visible up to': 'LOD visible jusqu\'à',
  'GENERATE LOD RESOURCE': 'GÉNÉRER LA RESSOURCE LOD', '3 · TREES IN THIS YMAP': '3 · ARBRES DE CE YMAP', 'All trees': 'Tous les arbres', 'None': 'Aucun',
  'Count': 'Nombre', 'LOD from': 'LOD depuis', 'Triangles': 'Triangles', 'Status': 'État', 'Choose the GTA folder and your ymap.': 'Choisis le dossier GTA et ton ymap.',
  'MAP': 'CARTE', 'top view ·': 'vue de dessus ·', 'gets a LOD ·': 'reçoit un LOD ·', 'unchanged': 'inchangé', 'LOG': 'JOURNAL',
  'ready': 'prêt', 'no low level - LOD = full model': 'pas de niveau bas - LOD = modèle complet', 'TREE': 'ARBRE',
  'Choose your GTA V folder first': 'Choisis d\'abord ton dossier GTA V', 'GTA V not found - use Choose…': 'GTA V introuvable - utilise Choisir…',
  'Not a GTA V Legacy folder (GTA5.exe + x64a.rpf needed)': 'Ce n\'est pas un dossier GTA V Legacy (GTA5.exe + x64a.rpf nécessaires)',
  'Reading your GTA files (the first time takes 10-60 s)…': 'Lecture de tes fichiers GTA (la première fois prend 10 à 60 s)…',
  'Where should the tree LOD resource be created?': 'Où créer la ressource LOD des arbres ?', 'Choose your GTA V Legacy folder (with GTA5.exe)': 'Choisis ton dossier GTA V Legacy (avec GTA5.exe)',
  // ---------------------------------------------------------------- TEXTURES
  'Type the name of a prop or a shell: the app finds it in your folder or in GTA V and exports': 'Tape le nom d\'un prop ou d\'un shell : l\'app le trouve dans ton dossier ou dans GTA V et exporte',
  'every texture it uses': 'toutes les textures qu\'il utilise', 'as': 'en',
  '(embedded in the model, its .ytd, the parent .ytd it uses). An MLO shell exports the textures of every object inside.': '(intégrées au modèle, son .ytd, les .ytd parents qu\'il utilise). Un shell MLO exporte les textures de tous les objets à l\'intérieur.',
  'Folders': 'Dossiers', 'Check': 'Vérifier', 'Export .dds': 'Exporter en .dds', '1 · WHERE TO SEARCH': '1 · OÙ CHERCHER', '(read only)': '(lecture seule)',
  'Your folder': 'Ton dossier', '(server resources, shells… searched first)': '(resources du serveur, shells… cherché en premier)', 'Clear': 'Vider',
  '2 · NAME': '2 · NOM', 'SEARCH': 'CHERCHER', 'Model, archetype (ytyp) or .ytd name. Without extension.': 'Nom du modèle, de l\'archétype (ytyp) ou du .ytd. Sans extension.',
  '4 · EXPORT': '4 · EXPORT', 'EXPORT .DDS': 'EXPORTER EN .DDS', '3 · TEXTURES': '3 · TEXTURES', 'All': 'Toutes', 'Type a name and SEARCH.': 'Tape un nom et CHERCHER.',
  'SEARCH THEM IN ALL GTA .YTD': 'LES CHERCHER DANS TOUS LES .YTD DE GTA', 'the first time takes a few minutes, then it is instant': 'la première fois prend quelques minutes, ensuite c\'est instantané',
  'SEARCHING ALL GTA .YTD…': 'RECHERCHE DANS TOUS LES .YTD…', 'Searching… (the first GTA search takes 10-60 s)': 'Recherche… (la première recherche GTA prend 10 à 60 s)',
  'Choose your GTA V folder or your own folder first': 'Choisis d\'abord ton dossier GTA V ou ton propre dossier', 'Where should the textures be exported?': 'Où exporter les textures ?',
  'Choose your folder (server resources, shells…)': 'Choisis ton dossier (resources du serveur, shells…)', 'not found': 'introuvable',
};

// texts built with numbers / names: [regex on the whole (trimmed) text, French replacement]
const FR_PATTERNS = [
  [/^(\d+) pieces · strength (\w+) · break preview$/, '$1 morceaux · solidité $2 · aperçu de la casse'],
  [/^([\d.]+) \/ ([\d.]+) s · (.+) · \.ycd loop$/, (m, a, b, c) => `${a} / ${b} s · ${tr(c)} · boucle .ycd`],
  [/^angle ([-\d.]+)° · ([\d.]+) s · (\w+)$/, (m, a, b, c) => `angle ${a}° · ${b} s · ${tr(c)}`],
  [/^offset ([-\d.]+) m · ([\d.]+) s · (\w+)$/, (m, a, b, c) => `décalage ${a} m · ${b} s · ${tr(c)}`],
  [/^lift ([\d.]+) m · (\d+) panels · ([\d.]+) s · (\w+)$/, (m, a, b, c, d) => `levée ${a} m · ${b} panneaux · ${c} s · ${tr(d)}`],
  [/^(\d+) pieces$/, '$1 morceaux'], [/^loop of$/, 'boucle de'],
  [/^\((.+) triangles after cutting\) ·$/, '($1 triangles après découpe) ·'],
  [/^\(explodes at ([\d.]+) s, on the ground at ([\d.]+) s\)\. Export =$/, '(explose à $1 s, au sol à $2 s). Export ='],
  [/^: GTA starts the clip by itself and loops it -$/, ' : GTA démarre le clip tout seul et le met en boucle -'],
  [/^\. The collision of every piece follows the animation\. Collision = (the real shape of every piece|one box per piece) \(material from COLLISION\)\.$/,
    (m, a) => `. La collision de chaque morceau suit l'animation. Collision = ${a.startsWith('the') ? 'la vraie forme de chaque morceau' : 'une boîte par morceau'} (matériau de COLLISION).`],
  [/^strength (\d+)\. In-game every piece breaks off by itself when an explosion, a vehicle or bullets hit it hard enough, then falls with real GTA physics -$/,
    'solidité $1. En jeu chaque morceau se détache tout seul quand une explosion, un véhicule ou des balles le frappent assez fort, puis tombe avec la vraie physique GTA -'],
  [/^\. Collision = (the real shape of every piece|one box per piece) \(material from COLLISION\)\.$/, (m, a) => `. Collision = ${a.startsWith('the') ? 'la vraie forme de chaque morceau' : 'une boîte par morceau'} (matériau de COLLISION).`],
  [/^Loop of$/, 'Boucle de'], [/^· (\d+) keys · turns around the pivot \(AUTO = centre of the model\)\.$/, '· $1 clés · tourne autour du pivot (AUTO = centre du modèle).'],
  [/^(\d+) trees get a LOD$/, '$1 arbres reçoivent un LOD'], [/^GENERATE LOD RESOURCE \((\d+) TREES\)$/, 'GÉNÉRER LA RESSOURCE LOD ($1 ARBRES)'],
  [/^(\d+) \/ (\d+) selected$/, '$1 / $2 sélectionnées'], [/^EXPORT (\d+) \.DDS$/, 'EXPORTER $1 .DDS'],
  [/^embedded in (.+)$/, 'intégrée dans $1'], [/^(.+)\.ytd \(parent\)$/, '$1.ytd (parent)'], [/^mapdetail\.ytd \(GTA shared\)$/, 'mapdetail.ytd (partagée GTA)'],
  [/^(\d+) textures exported$/, '$1 textures exportées'], [/^(\d+) model\(s\) · (\d+) textures$/, '$1 modèle(s) · $2 textures'], [/^· MLO shell · (\d+) model\(s\) · (\d+) textures$/, '· shell MLO · $1 modèle(s) · $2 textures'],
  [/^⚠ (\d+) not found \(used by the model but stored in another GTA \.ytd\): (.*)$/, '⚠ $1 introuvables (utilisées par le modèle mais rangées dans un autre .ytd de GTA) : $2'],
  [/^ {2}! (\d+) used textures not found \(in another GTA \.ytd\): (.*)$/, '  ! $1 textures utilisées introuvables (dans un autre .ytd de GTA) : $2'],
  [/^ {2}✓ (\d+) textures$/, '  ✓ $1 textures'], [/^ {2}✓ (\d+) found(.*)$/, (m, a, b) => `  ✓ ${a} trouvées${b.replace(/, (\d+) still missing/, ', $1 toujours introuvables')}`],
  [/^ {2}✓ (\d+) \.dds written$/, '  ✓ $1 .dds écrits'], [/^› search (\d+) missing textures in every GTA \.ytd$/, '› recherche de $1 textures manquantes dans tous les .ytd de GTA'],
  [/^ {2}✓ (\d+) entities, (\d+) tree models$/, '  ✓ $1 entités, $2 modèles d\'arbres'],
  [/^· (\d+) entities · (\d+) models$/, '· $1 entités · $2 modèles'],
  [/^⚠ (\d+) entities have the flag "LOD in Parented YMAP" with no LOD \(they can vanish\) - fixed by GENERATE$/, '⚠ $1 entités ont le flag « LOD in Parented YMAP » sans LOD (elles peuvent disparaître) - corrigé par GÉNÉRER'],
  [/^⚠ (\d+) entities already have a LOD$/, '⚠ $1 entités ont déjà un LOD'], [/^⚠ already has a parent ymap: (.*)$/, '⚠ a déjà un ymap parent : $1'],
  [/^Tree LOD resource "(.+)" ready$/, 'Ressource LOD des arbres « $1 » prête'], [/^ready: (\d+) trees linked to their LOD\. Restart: disconnect \+ reconnect to the server\.$/, 'prête : $1 arbres reliés à leur LOD. Redémarrage : déconnecte-toi et reconnecte-toi au serveur.'],
  [/^ {2}⚠ (.+) REPLACES your original ymap: remove the old one from its resource \(never stream both\)\.$/, '  ⚠ $1 REMPLACE ton ymap d\'origine : enlève l\'ancien de sa ressource (ne jamais streamer les deux).'],
  [/^ {2}✓ (.+): (\d+) trees, (\w+) level, (\d+) → (\d+) triangles$/, '  ✓ $1 : $2 arbres, niveau $3, $4 → $5 triangles'],
  [/^FiveM resource "(.+)" ready$/, 'Ressource FiveM « $1 » prête'], [/^Project saved: (.+)$/, 'Projet enregistré : $1'], [/^Project opened: (.+)$/, 'Projet ouvert : $1'],
  [/^There is already a key at ([\d.]+) s$/, 'Il y a déjà une clé à $1 s'], [/^(.+): (\d+) file\(s\) written$/, (m, a, b) => `${tr(a)} : ${b} fichier(s) écrit(s)`],
  [/^Unsupported file: (.+) \(use \.ydr, \.ydr\.xml, \.ytyp, \.ybn, \.ytd\)$/, 'Fichier non pris en charge : $1 (utilise .ydr, .ydr.xml, .ytyp, .ybn, .ytd)'],
  [/^Embedded collision kept \((.+)\)\.$/, 'Collision intégrée gardée ($1).'],
  [/^Auto pivot: hinge on the (\w+) edge(.*)$/, (m, a, b) => `Pivot auto : charnière sur le bord ${a === 'LEFT' ? 'GAUCHE' : a === 'RIGHT' ? 'DROIT' : a}${b ? ' (à l\'opposé de la poignée)' : ''}`],
  [/^ {2}✓ (\d+) pieces · explosion loop ([\d.]+) s \(\.ycd\) · collision follows the pieces \(\.yed\)$/, '  ✓ $1 morceaux · explosion en boucle $2 s (.ycd) · la collision suit les morceaux (.yed)'],
  [/^ {2}✓ (\d+) breakable pieces, one collision box each$/, '  ✓ $1 morceaux cassables, une boîte de collision chacun'],
  [/^ {2}⚠ (.+)\.ytyp = YOUR ytyp \+ this prop\. Use it in place of your original \(MLO resource\) - never stream both\. A \.bak copy of your file was kept\.$/,
    '  ⚠ $1.ytyp = TON ytyp + ce prop. Utilise-le à la place de l\'original (ressource du MLO) - ne streame jamais les deux. Une copie .bak de ton fichier a été gardée.'],
  [/^The archetype will be added to (.+) \(a \.bak copy of your file is kept\)$/, 'L\'archétype sera ajouté à $1 (une copie .bak de ton fichier est gardée)'],
  [/^Single \.exe version - nothing is installed: just delete$/, 'Version .exe unique - rien n\'est installé : supprime simplement'],
  [/^(.+) no script \(explosion loop\)$/, '$1 sans script (explosion en boucle)'], [/^(.+) no script \(breaks with explosions \/ impacts\)$/, '$1 sans script (casse avec les explosions / chocs)'],
  [/^(.+) no script \(auto loop\)$/, '$1 sans script (boucle auto)'],
];

// last resort for long texts glued together: replace known phrases inside the text
const FR_PHRASES = [
  [/Textures are in an external \.ytd - drop it to see them in Material Preview, and set its name in YTYP › Texture Dict\./g, 'Les textures sont dans un .ytd externe - dépose-le pour les voir en aperçu Matériau, et mets son nom dans YTYP › Dict. de textures.'],
  [/"([\w-]+)" looks like a vanilla GTA model: streaming it with that name replaces the original everywhere in the game\. Rename it in DOOR SETTINGS \(e\.g\. ([\w-]+)\)\./g, '« $1 » ressemble à un modèle GTA vanilla : le streamer avec ce nom remplace l\'original partout dans le jeu. Renomme-le dans RÉGLAGES DE LA PORTE (ex. $2).'],
  [/triangles after cutting/g, 'triangles après découpe'], [/\bloop of\b/g, 'boucle de'], [/computing the explosion…/g, 'calcul de l\'explosion…'],
  [/Embedded collision kept/g, 'Collision intégrée gardée'], [/→ embedded in the \.ydr/g, '→ intégrée au .ydr'], [/^embedded \(/g, 'intégrée ('],
  [/Convex hull: (\d+) vertices, (\d+) faces\./g, 'Enveloppe convexe : $1 sommets, $2 faces.'],
  [/\(primitive - best for dynamic doors\)/g, '(primitive - idéal pour les portes dynamiques)'],
  [/ - embedded into the YDR\./g, ' - intégrée au YDR.'],
  [/Door created: (\w+) door, pivot /g, 'Porte créée : porte $1, pivot '], [/YTYP data ready\. Check the door type\./g, 'données YTYP prêtes. Vérifie le type de porte.'],
  [/\bon the (left|right) edge\b/g, (m, a) => `sur le bord ${a === 'left' ? 'gauche' : 'droit'}`],
  [/ texture\(s\) loaded for preview/g, ' texture(s) chargée(s) pour l\'aperçu'],
  [/Hinge (LEFT|RIGHT) · opens (toward the front \(pull\)|away from the front \(push\))/g, (m, a, b) => `Charnière ${a === 'LEFT' ? 'GAUCHE' : 'DROITE'} · s'ouvre ${b.startsWith('toward') ? 'vers l\'avant (tirer)' : 'vers l\'arrière (pousser)'}`],
  [/\bheading\b/g, 'cap'], [/ · no script$/g, ' · sans script'], [/^Door created: /g, 'Porte créée : '], [/ created for (\d+) door\(s\) - fxmanifest lines copied \(Ctrl\+V\)/g, ' créé pour $1 porte(s) - lignes fxmanifest copiées (Ctrl+V)'],
  [/ - remove the ones that are not doors/g, ' - enlève ceux qui ne sont pas des portes'],
  [/Where should the audio file go\? \(your resource's audio folder\)/g, 'Où mettre le fichier audio ? (le dossier audio de ta ressource)'],
];

const ATTRS = ['title', 'placeholder'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']);
let lang = 'en';
let observer = null;

export function tr(s) {
  if (lang !== 'fr' || s == null) return s;
  const str = String(s), t = str.replace(/\s+/g, ' ').trim();
  if (!t) return str;
  let out = FR[t];
  if (out == null) for (const [re, rep] of FR_PATTERNS) { if (re.test(t)) { out = t.replace(re, rep); break; } }
  if (out == null) {
    let p = t, hit = false;
    for (const [re, rep] of FR_PHRASES) { const q = p.replace(re, rep); if (q !== p) { p = q; hit = true; } re.lastIndex = 0; }
    if (!hit) return str;
    out = p;
  }
  const lead = str.match(/^\s*/)[0], trail = str.match(/\s*$/)[0];
  return (lead ? ' ' : '') + out.trim() + (trail ? ' ' : '');
}
// patterns written with leading spaces (log lines) must keep them
function trKeep(s) {
  if (lang !== 'fr') return s;
  const lead = s.match(/^ */)[0];
  for (const [re, rep] of FR_PATTERNS) if (re.source.startsWith('^ {2}') && re.test(s)) return s.replace(re, rep);
  if (FR[s] != null) return FR[s];
  const r = tr(s);
  return r === s ? s : (lead.length > 1 ? lead + r.trimStart() : r);
}

function skipNode(n) {
  for (let e = n.parentElement; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.hasAttribute('data-noi18n') || e.classList.contains('lod-path') || e.id === 'ytyp-xml' || e.classList.contains('yp-body')) return true;
  }
  return false;
}
function doText(n) {
  if (skipNode(n)) return;
  if (lang === 'fr') {
    if (n.__fr != null && n.data === n.__fr) return;
    const src = n.data;
    const out = trKeep(src);
    if (out !== src) { n.__en = src; n.__fr = out; n.data = out; }
  } else if (n.__en != null && n.data === n.__fr) { n.data = n.__en; n.__fr = null; }
}
function doEl(el) {
  for (const a of ATTRS) {
    if (!el.hasAttribute || !el.hasAttribute(a)) continue;
    const k = 'data-en-' + a, v = el.getAttribute(a);
    if (lang === 'fr') {
      if (el.getAttribute('data-fr-' + a) === v) continue;
      const out = tr(v);
      if (out !== v) { el.setAttribute(k, v); el.setAttribute('data-fr-' + a, out); el.setAttribute(a, out); }
    } else if (el.hasAttribute(k) && el.getAttribute('data-fr-' + a) === v) { el.setAttribute(a, el.getAttribute(k)); el.removeAttribute('data-fr-' + a); }
  }
}
function walk(root) {
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  doEl(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) doText(n); else doEl(n); }
}

export function getLang() { return lang; }
export function setLang(l) {
  lang = l === 'fr' ? 'fr' : 'en';
  document.documentElement.lang = lang;
  walk(document.body);
  if (!observer) {
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doEl(m.target);
        else m.addedNodes.forEach((n) => walk(n));
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
}
export function defaultLang() { return /^fr/i.test(navigator.language || '') ? 'fr' : 'en'; }

# 🚗 Carnet d'Entretien Automobile (PWA)

Application web progressive (PWA) personnelle et 100% autonome pour le suivi intelligent et prédictif de l'entretien de vos véhicules (1 à 3 véhicules).

![PWA Ready](https://img.shields.io/badge/PWA-100%25%20Offline-success)
![No Backend](https://img.shields.io/badge/Architecture-100%25%20Vanilla%20JS-blue)
![Privacy](https://img.shields.io/badge/Donn%C3%A9es-100%25%20Locales%20(localStorage)-darkgreen)

---

## 🌟 Points Forts & Fonctionnalités

- **🧠 Moteur Prédictif Adaptatif** :
  - Calcule automatiquement vos rythmes de conduite quotidien, hebdomadaire et mensuel à partir de vos vrais relevés kilométriques.
  - Pondération exponentielle combinant court terme (~14 jours) et long terme (~90 jours).
  - Détection automatique des habitudes Semaine (jours ouvrés) vs Week-end après 8 semaines d'historique.
  - Fourchette d'incertitude dynamique (*ex: entre le 02/03 et le 20/03*) et calcul de la précision moyenne de l'algorithme.
- **🔄 Recalibrage Automatique à Chaque Relevé** :
  - Compare l'estimation avec le kilométrage réel saisi (*« écart de 90 km »*).
  - Recalcule instantanément toutes les échéances de tous les éléments d'entretien.
  - Détecte tout décalage d'échéance $\ge 7$ jours et propose un ré-export vers votre agenda.
- **🛠️ Plan d'Entretien & Codes Couleur d'Urgence** :
  - Badges de statut immédiats : 🔴 En retard, 🟠 Bientôt (< 1000 km ou < 30 jours), 🟢 OK, ⚪ À renseigner.
  - Jauges de progression visuelle de l'usure pour chaque composant.
  - Tri dynamique par urgence et filtres par statut.
  - Règle « Au premier des deux termes échu » (km ou délai calendaire).
- **✅ « Fait aujourd'hui » & Historique Détaillé** :
  - Formulaire rapide pré-rempli pour enregistrer une intervention effectuée.
  - Réinitialise automatiquement la date et le kilométrage cible.
  - Journal complet d'historique avec calcul automatique des dépenses totales (en DA).
  - Filtres par véhicule et par type d'opération.
- **📊 Écran d'Habitudes de Conduite (Native SVG)** :
  - Graphiques en barres hebdomadaires et mensuels générés en SVG natif (sans aucune librairie externe).
  - Comparatif odomètre réel vs kilométrage estimé.
- **📅 Export Calendrier Universel (.ics / iCalendar RFC 5545)** :
  - Export individuel ou global de toutes les échéances futures.
  - Double alarme intégrée à 7 jours et 1 jour avant chaque intervention.
  - Rappels récurrents (`RRULE`) pour ne jamais oublier de relever son compteur.
- **💾 Sauvegarde & Restauration JSON** :
  - Export complet en fichier JSON horodaté.
  - Import sécurisé avec validation structurelle et confirmation anti-écrasement.
  - Bannière de rappel automatique si aucune sauvegarde n'a été réalisée depuis plus de 30 jours.
- **📱 100% Hors-Ligne & Installable (PWA)** :
  - Service Worker (v5) avec mise en cache complète des ressources.
  - Manifest conforme installable sur Android, iOS (Safari) et Desktop (Chrome/Edge).
  - Détection automatique du statut réseau (En ligne / Hors-ligne).
  - Support natif Dark Mode / Light Mode (`prefers-color-scheme`).

---

## 🛠️ Stack Technique

- **HTML5 Sémantique**
- **CSS3 Moderne** (Variables CSS, Flexbox/Grid, Glassmorphism, Responsive Mobile-First)
- **Vanilla JavaScript (ES6+)** (Strictement aucun framework, aucun bundler, aucun package externe)
- **Stockage Local** : `localStorage` avec versionnage (`schemaVersion`)
- **Norme Calendrier** : RFC 5545 (iCalendar `.ics`)
- **PWA** : Service Worker Cache API & Web App Manifest

---

## 🚀 Installation & Utilisation Locale

Pour exécuter l'application sur votre machine :

```bash
# Avec Python 3
python -m http.server 8000

# Ou avec Node.js (npx)
npx serve .
```

Puis ouvrez votre navigateur sur : `http://localhost:8000`.

---

## 🌐 Déploiement sur GitHub Pages

1. Activez **GitHub Pages** dans les paramètres du dépôt :
   - Rendez-vous dans **Settings** > **Pages**.
   - Sous **Build and deployment** > **Branch**, sélectionnez `main` et `/ (root)`.
   - Cliquez sur **Save**.
2. Votre application sera disponible à l'adresse :
   `https://isaaxk.github.io/Carnet-d-Entretien-AUTO/`

---

## 🔒 Confidentialité & Données Privées

Toutes les données de vos véhicules et de vos entretiens restent **strictement stockées dans votre navigateur**. Aucun cookie traceur, aucun compte requis, aucun serveur distant. Pensez à utiliser l'export JSON dans **Paramètres** pour conserver une copie de vos données !

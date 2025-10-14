// @ts-check

import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  // ----------------------------------------------------
  // 1. INFORMACIÓN BÁSICA DEL SITIO (Billy GCP)
  // ----------------------------------------------------
  title: 'Billy GCP - Documentación de Mensajería',
  tagline: 'Servicio de cobro multicanal (WhatsApp, Correo, SMS) y lógica de tono en Google Cloud.',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },
  
  url: 'https://github.com/oblicuaDev/documentacion-gcp', 
  baseUrl: '/',

  // ----------------------------------------------------
  // 2. CONFIGURACIÓN DE REPOSITORIO (Placeholders)
  // ----------------------------------------------------
  organizationName: 'oblicuaDev', 
  projectName: 'documentacion-gcp',
  deploymentBranch: 'gh-pages',

  onBrokenLinks: 'throw',

  // Si solo vas a documentar en español
  i18n: {
    defaultLocale: 'es', 
    locales: ['es'], 
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/oblicuaDev/documentacion-gcp/tree/main/', 
        },
        blog: {
          showReadingTime: true,
          editUrl: 'https://github.com/oblicuaDev/documentacion-gcp/tree/main/',
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/docusaurus-social-card.jpg',
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        // ----------------------------------------------------
        // 3. BARRA DE NAVEGACIÓN SUPERIOR (NAVBAR)
        // ----------------------------------------------------
        title: 'Billy GCP',
        logo: {
          alt: 'Billy GCP Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'billyGcpSidebar', 
            position: 'left',
            label: 'Documentación 📖', 
          },
          // {to: '/blog', label: 'Novedades', position: 'left'}, 
          {
            // Repositorio de Código (Placeholder)
            href: 'https://github.com/oblicuaDev/documentacion-gcp',
            label: 'Código (GitHub) 🐙',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          // ----------------------------------------------------
          // 4. FOOTER
          // ----------------------------------------------------
          {
            title: 'Documentación',
            items: [
              {
                // Apunta a tu nueva página de introducción (ID: introduccion)
                label: 'Introducción',
                to: '/docs/introduccion', 
              },
            ],
          },
          {
            title: 'Más Recursos',
            items: [
              {
                label: 'Blog/Novedades',
                to: '/blog',
              },
              {
                // Repositorio de Código (Placeholder)
                label: 'Repositorio de Código',
                href: 'https://github.com/oblicuaDev/documentacion-gcp',
              },
            ],
          },
        ],
        // Cambia el nombre de la empresa al final
        copyright: `Copyright © ${new Date().getFullYear()} Oblicua. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        // Lenguajes para Cloud y desarrollo
        additionalLanguages: ['javascript', 'typescript', 'json', 'yaml', 'bash'],
      },
    }),
};

module.exports = config;
---
id: introduccion
title: 🚀 Introducción al Proyecto Billy
sidebar_label: 🚀 Introducción
---

# Bienvenido a la Documentación de Billy GCP

Billy es un sistema avanzado de **mensajería de cobranza y notificación** diseñado para Oblicua, aprovechando la infraestructura *serverless* de Google Cloud Platform (GCP) e inteligencia artificial.

## Propósito del Proyecto

El objetivo principal de Billy es **automatizar la comunicación de cobros** de forma inteligente, permitiendo a los clientes:

1. **Centralizar la Ingesta de Facturas** desde múltiples fuentes (Siigo, Cuenti, Google Sheets).
2. **Personalizar el Tono de Cobro** (Informal, Formal, Exigente) de manera dinámica usando IA.
3. **Utilizar Múltiples Canales** para el envío (WhatsApp, Correo Electrónico, SMS).

## Capacidades Principales

| Característica | Descripción |
| :--- | :--- |
| **Integración de Datos** | Conexión directa con sistemas de facturación (Siigo, Cuenti, Allegra) y matrices de Google Sheets para extraer facturas en mora. |
| **Lógica de Tono por IA** | Utiliza OpenAI para generar mensajes únicos con el tono (informal, formal, exigente) y la urgencia adecuada, basándose en la antigüedad y el monto de la deuda. |
| **Mensajería Multi-Canal** | Decide inteligentemente el mejor canal para cada cliente. Utiliza Campaign Monitor (Email) y sms.to (SMS/WhatsApp) para el envío. |
| **Seguridad de Credenciales** | Todas las claves de API de terceros se almacenan en **Secret Manager**, gestionadas por la función `save-user-credentials`, asegurando que las credenciales no se expongan en código ni en variables de entorno. |

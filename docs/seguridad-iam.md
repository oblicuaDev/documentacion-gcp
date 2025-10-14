---
id: seguridad-iam
title: 🛡️ Seguridad y IAM
sidebar_label: Seguridad (IAM)
---

# Seguridad y Gestión de Identidad y Acceso (IAM)

La seguridad en Billy GCP se basa en el **Principio de Mínimo Privilegio**, garantizando que cada componente (Cloud Functions, Cloud Workflows) solo tenga los permisos estrictamente necesarios para su tarea.

## 1. Cuentas de Servicio Principales

El flujo central de Billy está orquestado por la Cuenta de Servicio asociada al Cloud Workflow, la cual asume los roles más críticos.

| Cuenta de Servicio (SA) | Uso Principal |
| :--- | :--- |
| **`[PROJECT_ID]-compute@developer.gserviceaccount.com`** (Default Compute Engine SA) | Es la **identidad central** utilizada por el `Billy-workflow`. Es la que debe tener los permisos para invocar todas las funciones Cloud Run y acceder a Secret Manager. |
| **`[PROJECT_ID]@appspot.gserviceaccount.com`** (App Engine Default SA) | Utilizada por funciones Cloud Functions (si se usaran en lugar de Cloud Run). Actualmente, la mayoría de los servicios usan la Default Compute SA. |

## 2. Roles y Permisos Críticos

Los siguientes roles de IAM son indispensables para que la arquitectura funcione correctamente:

### A. Orquestación y Control de Flujo

| Componente | Rol Requerido | Propósito |
| :--- | :--- | :--- |
| **`ingest-task-from-billy`** | **`Workflows Invoker`** | Permite que esta función, tras recibir la petición del *frontend*, inicie la ejecución del `Billy-workflow`. |
| **Default Compute SA** | **`Cloud Run Invoker`** | Permite que el `Billy-workflow` invoque a las funciones privadas (`get-data-from-*` y `process-and-send-message`). |
| **Default Compute SA** | **`Workflows Editor`** | Permite gestionar y ejecutar el `Billy-workflow`. |

### B. Acceso a Datos y Secretos

| Componente | Rol Requerido | Propósito |
| :--- | :--- | :--- |
| **Default Compute SA** | **`Secret Manager Secret Accessor`** | **Permiso crítico**. Permite al *workflow* leer los valores de las claves de API y las credenciales de cliente almacenadas en Secret Manager. |
| **Default Compute SA** | **`Service Usage Consumer`** | Permite al *workflow* consumir las APIs de GCP (como Sheets API) al ejecutar los adaptadores de datos. |

## 3. Seguridad de Acceso a Endpoints (Cloud Run)

La autenticación de los *endpoints* está diseñada para proteger el flujo de datos y separar los puntos de acceso públicos de los privados.

| Función (Cloud Run) | Configuración de Autenticación | Mecanismo de Seguridad |
| :--- | :--- | :--- |
| **`ingest-task-from-billy`** | **Acceso público** | Protegido por validación CORS (solo permite el origen de la UI de Oblicua) y lógica de validación de *payload*. |
| **`save-user-credentials`** | **Acceso público** | Protegido por validación CORS. En producción, debe llevar validación de Token (JWT) para verificar la identidad del usuario de Oblicua. |
| **Adaptadores de Datos** (`get-data-from-*`) | **Necesita autenticación** | Solo pueden ser invocados por el **`Billy-workflow`** que se autentica usando la Default Compute Service Account. |
| **`process-and-send-message`** | **Necesita autenticación** | Solo invocado por el **`Billy-workflow`**. |
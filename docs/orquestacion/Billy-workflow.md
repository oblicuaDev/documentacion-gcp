---
id: billy-workflow
title: 🧩 Billy-workflow (Orquestación Central)
sidebar_label: Orquestación Central
---

# `Billy-workflow`

El `Billy-workflow` es el componente de **Orquestación Central** del sistema. Su única responsabilidad es ejecutar una secuencia de pasos lógicos (obtención, transformación, y procesamiento) para cada lote de facturas, independientemente de la fuente de datos (Cuenti, Siigo, Google Sheets).

## 1. Detalles de Despliegue

| Propiedad | Valor | Observaciones |
| :--- | :--- | :--- |
| **Nombre** | `Billy-workflow` | Nombre oficial de la instancia. |
| **Región GCP** | `northamerica-south1` | Región donde se ejecuta la orquestación. |
| **URL de Invocación** | `https://workflowexecutions.googleapis.com/v1/projects/billy-473802/locations/northamerica-south1/workflows/Billy-workflow/executions` | Usado por cronjobs o triggers externos. |
| **Cuenta de Servicio** | `projects/billy-473802/serviceAccounts/985640295677-compute@developer.gserviceaccount.com` | Esta cuenta debe tener permisos **IAM** para acceder a **Secret Manager** e invocar los servicios de **Cloud Run** (`get-data-from-*` y `process-and-send-message`). |

## 2. Estructura y Flujo de Ejecución

El workflow se divide en tres fases principales: **Inicialización**, **Obtención de Facturas** y **Procesamiento en Bucle**.

### Fase I: Inicialización y Definición de Plataforma (`init` y `define_platform`)

* **`init`**: Asigna el payload de entrada (`args`) a la variable `taskConfig` (que contiene el usuario de Billy y la configuración de la integración) e inicializa la lista `invoices` vacía.
* **`define_platform`**: Determina la plataforma de origen (`SIIGO`, `CUENTI`, o `GoogleSheets`). Si la plataforma no se especifica en el `taskConfig`, asume el valor por defecto: `"GoogleSheets"`.

### Fase II: Obtención de Facturas (`get_invoices_from_source`)

Esta sección utiliza una lógica **`switch`** para elegir la rama de ejecución basada en la variable `platform`.

| Plataforma | Pasos Clave | Mecanismo de Seguridad |
| :--- | :--- | :--- |
| **SIIGO / CUENTI** | 1. **`get_*_credentials`**: Llama a Secret Manager para obtener el `token` y `idEmpresa` del usuario específico. Si falla, genera un *error de workflow*. 2. **`call_*`**: Invoca la función Cloud Run respectiva (`get-data-from-siigo` o `get-data-from-cuenti`) con las credenciales y la configuración. | Usa **Secret Manager API** y la **Autenticación OIDC** para invocar Cloud Run. |
| **GoogleSheets** | 1. **`call_sheets`**: Invoca la función `get-data-from-sheets` directamente, usando el `link_drive` del `taskConfig` para obtener los datos. | Usa la **Autenticación OIDC** para invocar Cloud Run. |
| **Salida:** La respuesta HTTP de la función Cloud Run (que contiene el arreglo de facturas estandarizadas) se asigna a la variable global `invoices`.

### Fase III: Procesamiento en Bucle (`process_invoices_loop`)

Una vez que se tienen todas las facturas estandarizadas, el workflow itera sobre ellas individualmente:

1.  **Iteración (`for`):** Recorre el arreglo de facturas (`invoices.body`).
2.  **Llamada al Handler (`call_process_and_send`):** Por cada factura (`invoice`), invoca la función `process-and-send-message`. Esta función contiene la lógica de **filtro de canales** y **tono de mensaje**.
3.  **Manejo de Errores (`try/except`):**
    * Si la función de envío es exitosa, se registra un mensaje de **`log_success`**.
    * Si el envío de una factura falla (`except`), se registra un mensaje de **`log_error`** y el workflow **continúa con la siguiente factura** (es decir, el fallo es manejado por elemento, sin detener todo el lote).

## 3. Código YAML del Workflow

```yaml title="Billy-workflow.yaml"
main:
  params:
    - args
  steps:
    - init:
        assign:
          - taskConfig: ${args}
          - invoices: []
    - define_platform:
        try:
          assign:
            - platform: ${taskConfig.integration.platform}
        except:
          assign:
            - platform: "GoogleSheets"
    - get_invoices_from_source:
        switch:
          - condition: ${platform == "SIIGO"}
            steps:
              - get_siigo_credentials:
                  try:
                    call: googleapis.secretmanager.v1.projects.secrets.versions.access
                    args:
                      name: ${"projects/billy-473802/secrets/siigo-" + taskConfig.billy_user + "-credentials/versions/latest"}
                    result: siigoCreds
                  except:
                    as: e
                    raise: ${"No se encontraron las credenciales para el usuario de SIIGO " + taskConfig.billy_user}
              - call_siigo:
                  call: http.post
                  args:
                    url: "[https://get-data-from-siigo-985640295677.europe-west1.run.app](https://get-data-from-siigo-985640295677.europe-west1.run.app)"
                    auth:
                      type: OIDC
                    body:
                      credentials: ${json.decode(siigoCreds.payload.data)}
                      taskConfig: ${taskConfig}
                  result: invoices
          - condition: ${platform == "CUENTI"}
            steps:
              - get_cuenti_credentials:
                  try:
                    call: googleapis.secretmanager.v1.projects.secrets.versions.access
                    args:
                      name: ${"projects/billy-473802/secrets/cuenti-" + taskConfig.billy_user + "-credentials/versions/latest"}
                    result: cuentiCreds
                  except:
                    as: e
                    raise: ${"No se encontraron las credenciales para el usuario de CUENTI " + taskConfig.billy_user}
              - call_cuenti:
                  call: http.post
                  args:
                    url: [https://get-data-from-cuenti-985640295677.us-central1.run.app](https://get-data-from-cuenti-985640295677.us-central1.run.app)
                    auth:
                      type: OIDC
                    body:
                      credentials: ${json.decode(cuentiCreds.payload.data)}
                      taskConfig: ${taskConfig}
                  result: invoices
          - condition: ${platform == "GoogleSheets"}
            steps:
              - call_sheets:
                  call: http.post
                  args:
                    url: [https://get-data-from-sheets-985640295677.northamerica-south1.run.app](https://get-data-from-sheets-985640295677.northamerica-south1.run.app)
                    auth:
                      type: OIDC
                    body:
                      link_drive: ${taskConfig.link_drive}
                      isTest: ${taskConfig.isTest}
                  result: invoices
    - process_invoices_loop:
        for:
          value: invoice
          in: ${invoices.body}
          steps:
            - process_single_invoice:
                try:
                  steps:
                    - call_process_and_send:
                        call: http.post
                        args:
                          url: [https://process-and-send-message-985640295677.northamerica-south1.run.app](https://process-and-send-message-985640295677.northamerica-south1.run.app)
                          auth:
                            type: OIDC
                          body:
                            invoiceData: ${invoice}
                            taskConfig: ${taskConfig}
                        result: sendResult
                    - log_success:
                        call: sys.log
                        args:
                          text: ${"Resultado del envío " + json.encode(sendResult.body)}
                except:
                  as: e
                  steps:
                    - log_error:
                        call: sys.log
                        args:
                          text: ${"Error procesando factura " + e.message}
    - final_step:
        return: Proceso completado.
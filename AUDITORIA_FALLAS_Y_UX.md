# AUDITORÍA DE FALLAS, INCONSISTENCIAS Y EXPERIENCIA DE USUARIO (UX)

Este documento detalla los puntos críticos identificados tras una auditoría técnica de las 1,403 líneas del código fuente. Se clasifican por impacto técnico y de usabilidad.

---

## 1. FALLAS TÉCNICAS CRÍTICAS (ESTABILIDAD)

### 1.1 Límite de Desbordamiento de Canvas (High-DPI)
*   **Problema:** Al exportar a 600 DPI, el software intenta crear un lienzo de memoria masivo (ej. > 50,000px para faldas grandes).
*   **Riesgo:** Colapso total de la pestaña del navegador o generación de archivos corruptos/blancos, ya que Chrome/Firefox limitan el Canvas a ~32,768px.
*   **Recomendación:** Implementar un límite máximo de resolución y una advertencia de "Resolución no soportada por el hardware".

### 1.2 Gestión Ineficiente de Memoria (DataURLs)
*   **Problema:** El sistema almacena imágenes segmentadas y capas de PSD como strings Base64 (`DataURL`) en el estado de React.
*   **Riesgo:** El Base64 aumenta el peso del activo en un 33%. Múltiples capas de alta resolución pueden agotar la RAM disponible rápidamente, causando "lag" en el renderizado del lienzo.
*   **Recomendación:** Migrar el almacenamiento a `URL.createObjectURL(blob)` para manejar referencias binarias ligeras.

---

## 2. INCONSISTENCIAS LÓGICAS Y MATEMÁTICAS

### 2.1 Desvanecimiento de Elementos (Radios Negativos)
*   **Problema:** Al asignar offsets negativos que superan el radio de la cintura, los elementos desaparecen silenciosamente (`continue` en el bucle).
*   **Inconsistencia:** El usuario percibe esto como un "bug" de desaparición, no como un límite matemático. Falta retroalimentación visual de "Fuera de límites internos".

### 2.2 Validación de Producción Pasiva
*   **Problema:** El sistema muestra guías rojas de "Límites de Tela", pero permite exportar el archivo ignorando esta restricción.
*   **Falla de Lógica:** Semánticamente, el programa debería actuar como un filtro de ingeniería. Permitir la exportación de un diseño imposible de fabricar es una falla en el flujo industrial.

---

## 3. PROBLEMAS DE EXPERIENCIA DE USUARIO (UX)

### 3.1 Ausencia de Historial (Undo/Redo)
*   **Impacto:** Crítico. En una herramienta de diseño paramétrico, no poder deshacer un cambio accidental en la rotación o el borrado de una capa segmentada reduce drásticamente la productividad.

### 3.2 Riesgo de Pérdida de Datos (Borrado Directo)
*   **Problema:** El botón de la papelera elimina la capa instantáneamente sin diálogo de confirmación.
*   **Impacto:** Combinado con la falta de Undo, un clic erróneo puede causar la pérdida irreversible de un activo segmentado manualmente.

### 3.3 Interfaz Bloqueante y Alertas Invasivas
*   **Problema:** Uso extensivo de `alert()` nativo para errores de PSD y exportación.
*   **Impacto:** Interrumpe el flujo creativo y bloquea la interactividad del navegador. No se utilizan sistemas de notificación modernos (Toasts).

### 3.4 Falta de Persistencia de Sesión
*   **Problema:** El estado de las medidas de la falda (Cintura/Largo) y las capas se pierden al recargar la página.
*   **Impacto:** El diseñador no puede pausar y retomar su trabajo más tarde sin exportar y volver a importar todo el proyecto.

---

## 4. CUELLOS DE BOTELLA DE RENDIMIENTO

*   **Procesamiento de Segmentación (Main Thread):** El algoritmo BFS para segmentar elementos se ejecuta en el hilo principal de JavaScript. En imágenes de 4K o superiores, esto congelará la UI durante varios segundos.
*   **Reordenamiento de Capas:** Cada vez que se mueve una capa en la lista, React re-renderiza todo el árbol de componentes laterales, lo cual es ineficiente si el usuario tiene más de 20 capas activas.

---

## CONCLUSIÓN DE LA AUDITORÍA DE FALLAS
El software posee un motor matemático brillante para la geometría polar, pero carece de las capas de seguridad y gestión de memoria necesarias para un entorno de producción de alta demanda. La implementación de un sistema de **Undo**, la migración a **Blobs** y el manejo de **errores no bloqueantes** son las prioridades más altas para profesionalizar la herramienta.

---
**Auditoría realizada por Jules.**

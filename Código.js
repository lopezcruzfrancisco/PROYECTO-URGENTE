/**
 * PORTAL DE ACTUALIZACIÓN DE EXPEDIENTES RH — LimpiaLeón
 * Archivo: Código.gs · Versión 3 (acceso con PIN)
 *
 * Qué hace este archivo:
 *  - Acceso: número de empleado + PIN de 4 números. La primera vez (o si olvida su PIN) el empleado confirma
 *    que es él con los últimos 4 de su clave de elector, RFC o CURP. Ver sección "ACCESO CON PIN".
 *  - Busca al empleado en BD_MAESTRA_RH. Esa pestaña SOLO SE LEE, nunca se modifica aquí.
 *  - Al navegador solo le manda los campos que el empleado puede ver (los ocultos nunca salen del servidor).
 *  - Guarda lo que envía el empleado en una pestaña por cada paso del formulario, una fila por empleado:
 *      CONTROL EXP · DATOS GENERALES · DOMICILIO Y DATOS FISCALES · SALUD, EMERGENCIA Y LICENCIA · FAMILIARES
 *  - En FAMILIARES cada dato va en su columna y cada persona en un renglón dentro de la misma celda.
 *  - Al final de cada pestaña (menos CONTROL EXP) va el link a la carpeta de Drive con las fotos.
 *  - Folio = EXP-<ID>. Si RH lo marca "Incompleto" y el empleado corrige, se sobrescribe la misma fila y vuelve a "Pendiente".
 *  - CAMPANA = EXP-<MES>-<AÑO> del envío, p. ej. EXP-SEP-26.
 *  - Las fotos se guardan solo en Drive: EXPEDIENTES RH / DEPENDENCIA / ID / (FOTO DE PERFIL, INE EMPLEADO, LICENCIA, COMPROBANTE DOMICILIO)
 *
 * El envío se hace en tres llamadas para no mandar todas las fotos de golpe:
 * Todas reciben la sesión que se entrega al entrar con el PIN (el número de empleado sale de ahí, no del navegador).
 *  1) iniciarEnvio   → valida datos, guarda las filas (estado "En captura") y crea la carpeta.
 *  2) subirDocumento → una llamada por foto.
 *  3) finalizarEnvio → revisa que estén todas las fotos en Drive y cambia el estado a "Pendiente".
 */

// ============================================================
// CONFIGURACIÓN
// ============================================================
const CONFIG = {
  SPREADSHEET_ID: '1ZEy_P_0fvbfA9qMVKIrXQd2pBjv-iIVh-ekjbBQVpLI',
  HOJA_MAESTRA: 'BD_MAESTRA_RH',        // de aquí se LEEN los datos (nunca se modifica)
  HOJA_EXPEDIENTES: 'CONTROL EXP',      // control: folio, estado, revisor, observaciones, corregir
  CARPETA_RAIZ_ID: '1gYZSsbATgin39pDGaN3vatsOG9iKARUt',
  // Base de accesos (PIN): hoja de cálculo APARTE y sin compartir. Pega aquí su ID.
  // (Si lo dejas vacío y corres configurarAccesos(), el sistema crea el archivo solo.)
  ACCESOS_ID: '',
  CAMPANA: 'EXPEDIENTES 2026',
  DEPENDENCIAS: ['LIMPIALEON', 'FIDEURB', 'FIDEFIFA'],
  CONTACTO_RH: 'Acude al área de Recursos Humanos o pide ayuda a tu supervisor.',
  // Usuario de prueba: entra sin PIN, puede avanzar sin contestar y "enviar", pero NO se guarda nada.
  // Déjalo vacío ('') para desactivarlo.
  USUARIO_PRUEBA: 'X0000',
  MAX_HIJOS: 10,
  MAX_ADULTOS: 10,
  MAX_MB_ARCHIVO: 8
};

// Valores de la columna ESTADO de EXPEDIENTES (deben coincidir con el desplegable).
const ESTADOS = {
  CAPTURA: 'EN CAPTURA',     // lo pone el sistema mientras suben las fotos
  PENDIENTE: 'PENDIENTE',    // lo pone el sistema al terminar el envío; RH debe revisarlo
  COMPLETO: 'COMPLETADO',    // lo pone RH: ya no puede editar
  INCOMPLETO: 'INCOMPLETO'   // lo pone RH: el empleado puede corregir (se le muestran las OBSERVACIONES)
};

const ENC_EXPEDIENTES = ['FOLIO', 'ID_EMPLEADO', 'NOMBRE_COMPLETO', 'CAMPANA', 'DEPENDENCIA', 'FECHA_ENVIO',
  'ESTADO', 'REVISOR', 'FECHA_REVISION', 'CORREGIR', 'INE_NO_ENTREGADA', 'OBSERVACIONES',
  'INE_VIGENTE', 'INE_VIGENTE_FAMILIARES',
  'PDF_EXPEDIENTE',
  'DOM_COINCIDE_INE', 'DOM_COMPROBANTE_ACTUAL',
  'DOCS_RH']; // documentos que RH subió desde el Panel RH

// Columnas nuevas de CONTROL EXP: si faltan, se crean al final de la hoja (no mueven nada).
const COLUMNAS_AL_FINAL = ['INE_VIGENTE', 'INE_VIGENTE_FAMILIARES', 'PDF_EXPEDIENTE',
  'DOM_COINCIDE_INE', 'DOM_COMPROBANTE_ACTUAL', 'DOCS_RH'];

// Opciones de la columna CORREGIR (desplegable de selección múltiple) → lo que la página debe pedir otra vez.
const CORREGIR = {
  DATOSGENERALES: 'GENERALES', GENERALES: 'GENERALES',
  FAMILIA: 'FAMILIA',
  SALUDYEMERGENCIA: 'SALUD_EMERGENCIA', SALUDEMERGENCIAYUNIFORME: 'SALUD_EMERGENCIA',
  LICENCIAEINE: 'LICENCIA',
  DOMICILIO: 'DOMICILIO',
  SALUDYLICENCIA: 'SALUD', SALUD: 'SALUD',
  HIJOS: 'HIJOS',
  PERSONASQUEVIVENCONTIGO: 'ADULTOS', ADULTOS: 'ADULTOS',
  EMERGENCIAYTALLAS: 'EMERGENCIA', EMERGENCIA: 'EMERGENCIA', TALLAS: 'EMERGENCIA',
  FOTODEPERFIL: 'FOTO_PERFIL', FOTOPERFIL: 'FOTO_PERFIL',
  INE: 'INE',
  FOTODELICENCIA: 'LICENCIA_FOTO', LICENCIA: 'LICENCIA_FOTO',
  INEDEHIJOS: 'INE_HIJOS', INEHIJOS: 'INE_HIJOS',
  INEDEADULTOS: 'INE_ADULTOS', INEADULTOS: 'INE_ADULTOS',
  COMPROBANTEDEDOMICILIO: 'COMPROBANTE', COMPROBANTE: 'COMPROBANTE' // >>> CAMBIO
};

// Pestaña de salud, emergencia, uniforme y licencia (antes "SALUD Y LICENCIA"; si existe con ese nombre, se renombra sola).
const HOJA_SALUD = 'SALUD, EMERGENCIA Y LICENCIA';
const NOMBRES_ANTERIORES = {};
NOMBRES_ANTERIORES[HOJA_SALUD] = 'SALUD Y LICENCIA';

// Una pestaña por sección, con las columnas en este orden exacto.
const SECCIONES = [
  { hoja: 'DATOS GENERALES', columnas: ['FOLIO', 'CENTRO_COSTO', 'FECHA_INGRESO', 'ID_EMPLEADO', 'NOMBRE_COMPLETO',
    'PUESTO', 'TURNO', 'NOMBRE', 'APELLIDO_PATERNO', 'APELLIDO_MATERNO', 'FECHA_NACIMIENTO', 'EDAD', 'SEXO',
    'ESTADO_CIVIL', 'ESCOLARIDAD', 'TELEFONO', 'CORREO_PERSONAL', 'CARPETA_DRIVE'] },
  { hoja: 'DOMICILIO Y DATOS FISCALES', columnas: ['FOLIO', 'ID_EMPLEADO', 'NOMBRE_COMPLETO', 'CALLE_NUMERO', 'COLONIA',
    'MUNICIPIO', 'CODIGO_POSTAL', 'ESTADO_DOMICILIO', 'DOMICILIO', 'RFC', 'CURP', 'CARPETA_DRIVE'] },
  { hoja: HOJA_SALUD, columnas: ['FOLIO', 'ID_EMPLEADO', 'NOMBRE_COMPLETO', 'SERVICIO_MEDICO', 'SERVICIO_MEDICO_VIGENTE', 'TIPO_SANGRE',
    'MANEJA', 'TIPO_LICENCIA', 'ESTATUS_LICENCIA', 'CONTACTO_EMERGENCIA', 'PARENTESCO_EMERGENCIA', 'TELEFONO_EMERGENCIA',
    'TALLA_CAMISA', 'TALLA_OVEROL', 'TALLA_CALZADO', 'LENTES', 'CARPETA_DRIVE'] },
  { hoja: 'FAMILIARES', columnas: ['FOLIO', 'ID_EMPLEADO', 'NOMBRE_COMPLETO', 'NUMERO_HIJOS', 'NOMBRE_HIJOS',
    'FECHA_NACIMIENTO_HIJOS', 'EDAD_HIJOS', 'PERSONAS_DEPENDIENTES', 'NOMBRE_ADULTOS', 'EDAD_ADULTOS',
    'PARENTESCO_ADULTOS', 'CARPETA_DRIVE'] }
];
// Formato de las columnas de fecha en las pestañas.
const FORMATO_FECHA = { FECHA_INGRESO: 'dd/mm/yyyy', FECHA_NACIMIENTO: 'dd/mm/yyyy' };
const FORMATO_FECHA_HORA = 'dd/mm/yyyy hh:mm';

// Campos que captura el empleado (todo lo demás de la BD queda oculto).
const CAMPOS_EDITABLES = [
  'CENTRO_COSTO', 'PUESTO', 'TURNO',
  'NOMBRE', 'APELLIDO_PATERNO', 'APELLIDO_MATERNO', 'FECHA_NACIMIENTO', 'SEXO',
  'ESTADO_CIVIL', 'ESCOLARIDAD', 'TELEFONO', 'CORREO_PERSONAL',
  'CALLE_NUMERO', 'COLONIA', 'MUNICIPIO', 'CODIGO_POSTAL', 'ESTADO_DOMICILIO',
  'RFC', 'CURP',
  'SERVICIO_MEDICO', 'SERVICIO_MEDICO_VIGENTE', 'TIPO_SANGRE', 'MANEJA', 'TIPO_LICENCIA', 'ESTATUS_LICENCIA',
  'CONTACTO_EMERGENCIA', 'PARENTESCO_EMERGENCIA', 'TELEFONO_EMERGENCIA',
  'TALLA_CAMISA', 'TALLA_OVEROL', 'TALLA_CALZADO', 'LENTES'
];
// Se muestra pero el empleado NO la puede cambiar: siempre se guarda lo que dice la BD.
const CAMPOS_FIJOS = ['CENTRO_COSTO'];
// No se precargan: el empleado los escribe siempre desde cero.
const CAMPOS_SIN_PRECARGA = ['TELEFONO', 'CORREO_PERSONAL'];
const CAMPOS_FECHA = ['FECHA_NACIMIENTO'];
const CAMPOS_OBLIGATORIOS = [
  'TURNO', 'NOMBRE', 'APELLIDO_PATERNO', 'APELLIDO_MATERNO', 'FECHA_NACIMIENTO', 'SEXO',
  'ESTADO_CIVIL', 'ESCOLARIDAD', 'TELEFONO',
  'CALLE_NUMERO', 'COLONIA', 'MUNICIPIO', 'CODIGO_POSTAL', 'ESTADO_DOMICILIO',
  'RFC', 'CURP',
  'CONTACTO_EMERGENCIA', 'PARENTESCO_EMERGENCIA', 'TELEFONO_EMERGENCIA'
];

const ETIQUETAS = {
  TURNO: 'Lapso de servicio', NOMBRE: 'Nombre', APELLIDO_PATERNO: 'Apellido paterno', APELLIDO_MATERNO: 'Apellido materno',
  FECHA_NACIMIENTO: 'Fecha de nacimiento', FECHA_INGRESO: 'Fecha de ingreso', SEXO: 'Sexo',
  ESTADO_CIVIL: 'Estado civil', ESCOLARIDAD: 'Escolaridad', TELEFONO: 'Teléfono celular',
  CORREO_PERSONAL: 'Correo personal', CALLE_NUMERO: 'Calle y número', COLONIA: 'Colonia', MUNICIPIO: 'Municipio',
  CODIGO_POSTAL: 'Código postal', ESTADO_DOMICILIO: 'Estado', RFC: 'RFC', CURP: 'CURP',
  CONTACTO_EMERGENCIA: 'Contacto de emergencia',
  PARENTESCO_EMERGENCIA: 'Parentesco de emergencia', TELEFONO_EMERGENCIA: 'Teléfono de emergencia'
};

// Opciones de las listas. v = valor que se guarda, t = texto que ve el empleado.
const OPCIONES = {
  CENTRO_COSTO: op_(['LIMPIALEON'], ['FIDEURB'], ['FIDEFIFA']),
  PUESTO: op_(['AYUDANTE GENERAL', 'Ayudante general'], ['RESPONSABLE DE CUADRILLAS', 'Responsable de cuadrillas'],
    ['SUPERVISOR', 'Supervisor(a)'], ['ADMINISTRATIVO', 'Administrativo']),
  MUNICIPIO: op_(['MONTERREY', 'Monterrey'], ['GUADALUPE', 'Guadalupe'], ['SAN NICOLÁS DE LOS GARZA', 'San Nicolás de los Garza'],
    ['APODACA', 'Apodaca'], ['GENERAL ESCOBEDO', 'General Escobedo'], ['SANTA CATARINA', 'Santa Catarina'],
    ['SAN PEDRO GARZA GARCÍA', 'San Pedro Garza García'], ['JUÁREZ', 'Juárez'], ['GARCÍA', 'García'],
    ['CADEREYTA JIMÉNEZ', 'Cadereyta Jiménez'], ['SANTIAGO', 'Santiago'], ['SALINAS VICTORIA', 'Salinas Victoria'],
    ['CIÉNEGA DE FLORES', 'Ciénega de Flores'], ['GENERAL ZUAZUA', 'General Zuazua'], ['PESQUERÍA', 'Pesquería'],
    ['OTRO', 'Otro (escribirlo)']),
  TURNO: op_(['DIA', 'Día'], ['TARDE', 'Tarde'], ['NOCHE', 'Noche'], ['FIN DE SEMANA', 'Fin de semana'],
    ['PINTURA', 'Pintura'], ['PINTURA TARDE', 'Pintura tarde'], ['ADMINISTRATIVO', 'Administrativo'],
    ['GOBERNACION', 'Gobernación'], ['BODEGA', 'Bodega']),
  SEXO: op_(['FEMENINO', 'Femenino'], ['MASCULINO', 'Masculino']),
  ESTADO_CIVIL: op_(['SOLTERO', 'Soltero(a)'], ['CASADO', 'Casado(a)'], ['UNIÓN LIBRE', 'Unión libre'],
    ['DIVORCIADO', 'Divorciado(a)'], ['VIUDO', 'Viudo(a)'], ['OTRO', 'Otro']),
  ESCOLARIDAD: op_(['NO TIENE', 'Sin estudios'], ['PRIMARIA', 'Primaria'], ['SECUNDARIA', 'Secundaria'],
    ['PREPARATORIA', 'Preparatoria'], ['TÉCNICA', 'Carrera técnica'], ['LICENCIATURA', 'Licenciatura'],
    ['POSGRADO', 'Posgrado']),
  ESTADO_DOMICILIO: op_(['NUEVO LEÓN', 'Nuevo León'], ['AGUASCALIENTES', 'Aguascalientes'],
    ['BAJA CALIFORNIA', 'Baja California'], ['BAJA CALIFORNIA SUR', 'Baja California Sur'], ['CAMPECHE', 'Campeche'],
    ['CHIAPAS', 'Chiapas'], ['CHIHUAHUA', 'Chihuahua'], ['CIUDAD DE MÉXICO', 'Ciudad de México'],
    ['COAHUILA', 'Coahuila'], ['COLIMA', 'Colima'], ['DURANGO', 'Durango'], ['ESTADO DE MÉXICO', 'Estado de México'],
    ['GUANAJUATO', 'Guanajuato'], ['GUERRERO', 'Guerrero'], ['HIDALGO', 'Hidalgo'], ['JALISCO', 'Jalisco'],
    ['MICHOACÁN', 'Michoacán'], ['MORELOS', 'Morelos'], ['NAYARIT', 'Nayarit'], ['OAXACA', 'Oaxaca'],
    ['PUEBLA', 'Puebla'], ['QUERÉTARO', 'Querétaro'], ['QUINTANA ROO', 'Quintana Roo'],
    ['SAN LUIS POTOSÍ', 'San Luis Potosí'], ['SINALOA', 'Sinaloa'], ['SONORA', 'Sonora'], ['TABASCO', 'Tabasco'],
    ['TAMAULIPAS', 'Tamaulipas'], ['TLAXCALA', 'Tlaxcala'], ['VERACRUZ', 'Veracruz'], ['YUCATÁN', 'Yucatán'],
    ['ZACATECAS', 'Zacatecas']),
  SERVICIO_MEDICO: op_(['ISSSTELEÓN', 'ISSSTELEÓN'], ['IMSS', 'IMSS'], ['CUIDAR TU SALUD', 'Cuidar Tu Salud'],
    ['ISSSTE FEDERAL', 'ISSSTE (Federal)'], ['PRIVADO', 'Privado o particular'], ['NINGUNO', 'Ninguno'], ['OTRO', 'Otro']),
  SERVICIO_MEDICO_VIGENTE: op_(['SÍ', 'Sí'], ['NO', 'No']),
  TIPO_SANGRE: op_(['O+'], ['O-'], ['A+'], ['A-'], ['B+'], ['B-'], ['AB+'], ['AB-'], ['NO SÉ', 'No sé']),
  MANEJA: op_(['SÍ', 'Sí'], ['NO', 'No']),
  TIPO_LICENCIA: op_(['A - AUTOMOVILISTA', 'A — Automovilista'], ['C - CHOFER', 'C — Chofer'],
    ['M - MOTOCICLISTA', 'M — Motociclista'], ['T - ESPECIAL / TRANSPORTE PÚBLICO', 'T — Especial / Transporte público'],
    ['NO TIENE', 'No tengo licencia']),
  ESTATUS_LICENCIA: op_(['VIGENTE', 'Vigente'], ['VENCIDA', 'Vencida'], ['EN TRÁMITE', 'En trámite']),
  TALLA_CAMISA: op_(['CH'], ['M'], ['G'], ['XG'], ['XXG'], ['XXXG'], ['XXXXG']),
  TALLA_OVEROL: op_(['CH'], ['M'], ['G'], ['XG'], ['XXG'], ['XXXG'], ['XXXXG']),
  TALLA_CALZADO: op_.apply(null, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(function (n) { return [String(n), 'Talla ' + n]; })),
  LENTES: op_(['SÍ', 'Sí'], ['NO', 'No']),
  PARENTESCO: op_(['PAREJA', 'Esposo(a) / pareja'], ['PADRE', 'Padre'], ['MADRE', 'Madre'],
    ['HERMANO(A)', 'Hermano(a)'], ['ABUELO(A)', 'Abuelo(a)'], ['SUEGRO(A)', 'Suegro(a)'],
    ['OTRO FAMILIAR', 'Otro familiar'], ['NO ES FAMILIAR', 'No es familiar'])
};

// Valores viejos de la BD que se traducen a una opción de la lista (ya "simplificados").
const ALIAS = {
  SERVICIO_MEDICO: {
    CUIDATUSALUD: 'CUIDAR TU SALUD', BENEFICIARIOENIMSS: 'IMSS', BENEFICIARIOISSSTELEON: 'ISSSTELEÓN',
    ISSSTE: 'ISSSTE FEDERAL', PARTICULAR: 'PRIVADO'
  },
  PUESTO: { OPERATIVO: 'AYUDANTE GENERAL', AUXILIARADMINISTRATIVO: 'ADMINISTRATIVO', SUPERVISORA: 'SUPERVISOR' },
  MUNICIPIO: { SANNICOLAS: 'SAN NICOLÁS DE LOS GARZA', ESCOBEDO: 'GENERAL ESCOBEDO', SANPEDRO: 'SAN PEDRO GARZA GARCÍA',
    CADEREYTA: 'CADEREYTA JIMÉNEZ', ZUAZUA: 'GENERAL ZUAZUA', CIENEGA: 'CIÉNEGA DE FLORES' },
  LENTES: { X: 'SÍ' }
};

// >>> CAMBIO: solo imágenes (foto del celular o de la galería). Ya no se aceptan PDF, para poder incluir todos los documentos en el PDF del expediente.
const TIPOS_ARCHIVO = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

// ============================================================
// PÁGINA WEB
// ============================================================
function doGet(e) {
  if (enMantenimiento_()) return paginaMantenimiento_();
  const plantilla = HtmlService.createTemplateFromFile('Index');
  plantilla.campana = CONFIG.CAMPANA;
  plantilla.contactoRH = CONFIG.CONTACTO_RH;
  return plantilla.evaluate()
    .setTitle('Actualización de expediente · LimpiaLeón')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============================================================
// MODO MANTENIMIENTO (igual que en asistencia)
// ============================================================
// Para pausar la página: ejecutar activarMantenimiento() desde el editor.
// Para volver a abrirla: ejecutar desactivarMantenimiento().
// No hace falta publicar una versión nueva: el cambio es inmediato.

function enMantenimiento_() {
  return PropertiesService.getScriptProperties().getProperty('MODO_MANTENIMIENTO') === 'true';
}

function paginaMantenimiento_() {
  return HtmlService
    .createHtmlOutput(obtenerHtmlMantenimiento_())
    .setTitle('LIMPIALEON')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// >>> SEGURIDAD: en Apps Script cualquier función cuyo nombre no termina en "_"
// se puede llamar desde el navegador. Las funciones de administrador revisan
// que las ejecute desde el editor la misma cuenta dueña del proyecto.
function verificarAccesoAdministrador_() {
  const activa = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const efectiva = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (!activa || activa !== efectiva) {
    throw new Error('No autorizado. Esta función solo se puede ejecutar desde el editor de Apps Script.');
  }
}

function activarMantenimiento() {
  verificarAccesoAdministrador_();
  PropertiesService.getScriptProperties().setProperty('MODO_MANTENIMIENTO', 'true');
  Logger.log('Modo mantenimiento ACTIVADO');
}

function desactivarMantenimiento() {
  verificarAccesoAdministrador_();
  PropertiesService.getScriptProperties().setProperty('MODO_MANTENIMIENTO', 'false');
  Logger.log('Modo mantenimiento DESACTIVADO');
}

function obtenerHtmlMantenimiento_() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <base target="_top">
      <title>LIMPIALEON</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">

      <style>
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          min-height: 100vh;
          font-family: 'Inter', Arial, Helvetica, sans-serif;
          background: #eef0f3;
          color: #1c1c1e;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }

        .contenedor {
          width: 100%;
          max-width: 520px;
        }

        .tarjeta {
          background: white;
          border-radius: 26px;
          overflow: hidden;
          box-shadow: 0 20px 50px rgba(0,0,0,.10);
          text-align: center;
        }

        .encabezado-banner {
          background: linear-gradient(135deg, #1c1c1e 0%, #2c2c2e 100%);
          padding: 35px 25px;
          color: white;
          border-bottom: 4px solid #e87511;
        }

        .encabezado-banner h1 {
          margin: 0;
          font-size: 26px;
          font-weight: 800;
          letter-spacing: 1px;
          color: #ffffff;
        }

        .encabezado-banner p {
          margin: 6px 0 0;
          font-size: 13px;
          font-weight: 600;
          color: #e87511;
          letter-spacing: 1.5px;
          text-transform: uppercase;
        }

        .contenido {
          padding: 40px 30px;
        }

        .icono-estado {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: #fff3cd;
          color: #856404;
          margin: 0 auto 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #ffeeba;
        }

        .icono-estado svg {
          width: 36px;
          height: 36px;
          stroke: #e87511;
        }

        .titulo-aviso {
          font-size: 20px;
          font-weight: 800;
          color: #1c1c1e;
          margin-bottom: 12px;
          line-height: 1.3;
        }

        .mensaje-aviso {
          font-size: 14.5px;
          color: #5a5d63;
          line-height: 1.6;
          margin: 0 0 28px;
        }

        .caja-info {
          background: #f8f9fb;
          border: 1px solid #edeef1;
          border-radius: 16px;
          padding: 18px;
          font-size: 13px;
          color: #6b6e75;
          text-align: left;
          line-height: 1.5;
        }

        .caja-info strong {
          color: #1c1c1e;
          display: block;
          margin-bottom: 4px;
        }

        .pie {
          margin-top: 25px;
          color: #b4b6bb;
          font-size: 11.5px;
          text-align: center;
        }
      </style>
    </head>

    <body>

      <div class="contenedor">

        <div class="tarjeta">

          <div class="encabezado-banner">
            <h1>LIMPIALEON</h1>
            <p>Cuestionario de datos personales</p>
          </div>

          <div class="contenido">

            <div class="icono-estado">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round">

                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>

              </svg>
            </div>

            <div class="titulo-aviso">
              SISTEMA TEMPORALMENTE FUERA DE SERVICIO
            </div>

            <p class="mensaje-aviso">
              El cuestionario de datos personales se encuentra en mantenimiento programado o pausado de manera temporal. Intenta de nuevo más tarde.
            </p>

            <div class="caja-info">
              <strong>
                ¿Tienes alguna duda?
              </strong>

              Por favor comunícate directamente con la coordinación o con el departamento de Recursos Humanos para mayor información.
            </div>

          </div>

        </div>

        <div class="pie">
          LIMPIALEON &copy; Todos los derechos reservados
        </div>

      </div>

    </body>
    </html>
  `;
}

// ============================================================
// FUNCIONES QUE LLAMA EL NAVEGADOR
// ============================================================

/** Expediente del empleado con sesión abierta: sus datos precargados (lo llama cargarExpediente). */
function datosExpediente_(id) {
  const emp = obtenerEmpleadoMaestro_(id);
  if (!emp) throw new Error('El número de prestador de servicio no es válido.');

  const tz = libro_().getSpreadsheetTimeZone();
  const envio = envioDe_(id);
  const estado = envio ? estadoDe_(envio.datos.ESTADO) : '';

  if (estado === 'PENDIENTE' || estado === 'COMPLETO') {
    const f = envio.datos.FECHA_ENVIO;
    return {
      ok: true,
      estado: estado,
      nombre: aTexto_(emp.NOMBRE, tz),
      folio: folio_(id),
      fechaEnvio: aFecha_(f) ? Utilities.formatDate(aFecha_(f), tz, 'dd/MM/yyyy') : ''
    };
  }

  // Envío que se quedó a medias ("En captura"): si venía de una corrección de RH se retoma como corrección;
  // si no, se retoma con lo que ya había capturado.
  let modo = estado === 'INCOMPLETO' ? 'INCOMPLETO' : 'NUEVO';
  if (estado === 'CAPTURA') {
    modo = (corregirDe_(envio.datos.CORREGIR).length || String(envio.datos.OBSERVACIONES || '').trim()) ? 'INCOMPLETO' : 'CAPTURA';
  }

  const r = {
    ok: true,
    estado: modo,
    observaciones: '',
    datos: datosParaCliente_(emp, tz),
    hijos: [],
    adultos: [],
    fotosExistentes: [],
    corregir: [],
    sinIne: [],
    ineVigente: {}, // >>> CAMBIO: respuestas "¿Está vigente?" de la vez pasada
    domicilio: { coincide: '', actual: '' }, // >>> CAMBIO: respuestas del comprobante de domicilio
    opciones: OPCIONES,
    maxHijos: CONFIG.MAX_HIJOS,
    maxAdultos: CONFIG.MAX_ADULTOS
  };
  if (modo === 'INCOMPLETO' || modo === 'CAPTURA') {
    // Se precarga lo que el empleado envió la vez pasada y las fotos que ya están en Drive.
    if (modo === 'INCOMPLETO') {
      r.observaciones = String(envio.datos.OBSERVACIONES || '');
      r.corregir = corregirDe_(envio.datos.CORREGIR);
    }
    r.sinIne = String(envio.datos.INE_NO_ENTREGADA || '').split(',').map(function (x) { return x.trim(); }).filter(String);
    r.ineVigente = ineVigenteGuardada_(envio.datos); // >>> CAMBIO
    // >>> CAMBIO: respuestas del comprobante de domicilio de la vez pasada
    r.domicilio = { coincide: siNoGuardado_(envio.datos.DOM_COINCIDE_INE), actual: siNoGuardado_(envio.datos.DOM_COMPROBANTE_ACTUAL) };
    const previo = envioPrevio_(folio_(id), emp, tz);
    Object.assign(r.datos, previo.datos);
    r.hijos = previo.hijos;
    r.adultos = previo.adultos;
    r.datos.NUMERO_HIJOS = String(previo.hijos.length);
    r.datos.PERSONAS_DEPENDIENTES = String(previo.adultos.length);
    r.fotosExistentes = fotosExistentes_(String(envio.datos.DEPENDENCIA || 'SIN DEPENDENCIA'), id);
    // >>> CAMBIO: envío a medias en el que ya cambió la persona de un lugar (HIJO 1, ADULTO 1…): la INE que está
    // en Drive es de la persona anterior, así que no se muestra como "Ya la subiste" (la página la pide otra vez).
    const cambiados = familiaresCambiados_(folio_(id));
    r.fotosExistentes = r.fotosExistentes.filter(function (k) {
      const m = k.match(/^(HIJO|ADULTO)_(\d+)_/);
      return !m || cambiados.indexOf(m[1] + ' ' + m[2]) === -1;
    });
  }
  return r;
}

/** Envío 1/3: valida y guarda una fila por pestaña (estado "En captura"). */
function iniciarEnvio(sesion, p) {
  const id = idDeSesion_(sesion);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    p = p || {};
    const emp = obtenerEmpleadoMaestro_(id);
    if (!emp) throw new Error('El número de prestador de servicio no es válido.');

    const envio = envioDe_(id);
    const est = envio ? estadoDe_(envio.datos.ESTADO) : '';
    if (est === 'PENDIENTE' || est === 'COMPLETO') {
      throw new Error('Ya enviaste tu expediente (folio ' + folio_(id) + ').');
    }

    const tz = libro_().getSpreadsheetTimeZone();
    const d = sanitizarDatos_(p.datos || {});
    CAMPOS_FIJOS.forEach(function (c) { const o = valorOriginal_(emp, c, tz); if (o) d[c] = o; });
    validarDatos_(d);
    const hijos = sanitizarHijos_(p.hijos);
    const adultos = sanitizarAdultos_(p.adultos);
    const sinIne = sinIne_(p.sinIne, hijos, adultos);
    const vigente = ineVigente_(p.ineVigente, hijos, adultos, sinIne); // >>> CAMBIO: solo estadística, no bloquea
    const domicilio = domicilioResp_(p.domicilio); // >>> CAMBIO: las dos preguntas son obligatorias, se haya entregado o no el comprobante

    // Calculados
    d.NOMBRE_COMPLETO = [d.NOMBRE, d.APELLIDO_PATERNO, d.APELLIDO_MATERNO].filter(String).join(' ');
    d.EDAD = calcularEdad_(d.FECHA_NACIMIENTO);
    d.DOMICILIO = [d.CALLE_NUMERO, d.COLONIA ? 'COL. ' + d.COLONIA : '', d.MUNICIPIO, d.ESTADO_DOMICILIO,
      d.CODIGO_POSTAL ? 'C.P. ' + d.CODIGO_POSTAL : ''].filter(String).join(', ');
    CAMPOS_FECHA.forEach(function (c) { d[c] = d[c] ? isoAFecha_(d[c]) : ''; });
    const ingreso = valorOriginal_(emp, 'FECHA_INGRESO', tz); // no se muestra al empleado; se copia de la BD
    d.FECHA_INGRESO = ingreso ? isoAFecha_(ingreso) : '';
    Object.assign(d, filaFamiliares_(hijos, adultos));

    const folio = folio_(id);
    const base = { FOLIO: folio, ID_EMPLEADO: id, NOMBRE_COMPLETO: d.NOMBRE_COMPLETO };

    const depOficial = String(emp.CENTRO_COSTO || '').trim().toUpperCase();
    // >>> CAMBIO: en un reenvío (corrección o envío a medias) se sigue usando la carpeta donde ya están sus fotos
    // (la DEPENDENCIA guardada en CONTROL EXP), aunque RH haya cambiado su CENTRO_COSTO en la BD; si no, las fotos
    // "ya subidas" quedarían en la carpeta vieja y finalizarEnvio no las encontraría. Expediente nuevo: como antes.
    const depGuardada = envio ? String(envio.datos.DEPENDENCIA || '') : '';
    const dependencia = depGuardada.trim() ? depGuardada
      : (CONFIG.DEPENDENCIAS.indexOf(depOficial) !== -1 ? depOficial
        : (CONFIG.DEPENDENCIAS.indexOf(d.CENTRO_COSTO) !== -1 ? d.CENTRO_COSTO : 'SIN DEPENDENCIA'));
    d.CARPETA_DRIVE = carpetaEmpleado_(dependencia, id).getUrl(); // la crea si no existe

    // >>> CAMBIO: antes de reemplazar FAMILIARES se apunta de quién es cada INE que ya está en Drive (por lugar).
    guardarDuenosIne_(folio, est);

    // EXPEDIENTES: solo se tocan estas columnas (se respetan REVISOR y OBSERVACIONES de RH).
    guardarFila_(obtenerHoja_(CONFIG.HOJA_EXPEDIENTES, ENC_EXPEDIENTES), Object.assign({}, base, {
      CAMPANA: campana_(new Date(), tz),
      DEPENDENCIA: dependencia,
      FECHA_ENVIO: new Date(),
      ESTADO: ESTADOS.CAPTURA,
      INE_NO_ENTREGADA: sinIne.join(', '),
      INE_VIGENTE: vigente.empleado,            // >>> CAMBIO
      INE_VIGENTE_FAMILIARES: vigente.familiares, // >>> CAMBIO
      DOM_COINCIDE_INE: domicilio.coincide,       // >>> CAMBIO
      DOM_COMPROBANTE_ACTUAL: domicilio.actual    // >>> CAMBIO
    }), false);

    // Una fila por pestaña; si ya existía (reenvío), se reemplaza completa.
    SECCIONES.forEach(function (s) {
      const fila = Object.assign({}, d, base);
      guardarFila_(obtenerHoja_(s.hoja, s.columnas), fila, true);
    });

    return { ok: true, folio: folio };
  } finally {
    lock.releaseLock();
  }
}

/** Envío 2/3: guarda una foto (perfil, INE, licencia o comprobante) en la carpeta del empleado en Drive. */
function subirDocumento(sesion, folio, meta, base64, mimeType) {
  const id = idDeSesion_(sesion);
  const envio = envioAbierto_(folio, id);
  const m = validarMeta_(meta);
  const ext = TIPOS_ARCHIVO[mimeType];
  if (!ext) throw new Error('Tipo de archivo no permitido. Sube una foto (no se aceptan PDF).');
  const bytes = Utilities.base64Decode(String(base64 || ''));
  if (!bytes.length) throw new Error('El archivo llegó vacío.');
  if (bytes.length > CONFIG.MAX_MB_ARCHIVO * 1024 * 1024) throw new Error('El archivo es demasiado grande.');

  const carpetaEmp = carpetaEmpleado_(String(envio.datos.DEPENDENCIA || 'SIN DEPENDENCIA'), id);
  const sub = obtenerOCrearCarpeta_(carpetaEmp, nombreSubcarpeta_(m));
  const base = nombreArchivo_(id, m);

  // Se reemplaza la foto anterior del mismo documento (reintento o reenvío).
  const previos = sub.getFiles();
  while (previos.hasNext()) {
    const f = previos.next();
    if (f.getName().indexOf(base + '.') === 0 && !f.isTrashed()) f.setTrashed(true);
  }
  sub.createFile(Utilities.newBlob(bytes, mimeType, base + ext));
  return { ok: true };
}

/** Envío 3/3: confirma que están todas las fotos en Drive y deja el expediente "Pendiente" para RH. */
function finalizarEnvio(sesion, folio) {
  const id = idDeSesion_(sesion);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let resultado = null; // >>> CAMBIO
  try {
    const envio = envioAbierto_(folio, id);
    const carpetaEmp = carpetaEmpleado_(String(envio.datos.DEPENDENCIA || 'SIN DEPENDENCIA'), id);

    // Las fotos que RH marcó en CORREGIR deben ser nuevas (subidas en este envío).
    const corregir = corregirDe_(envio.datos.CORREGIR);
    const enviado = aFecha_(envio.datos.FECHA_ENVIO);
    const inicio = enviado ? new Date(enviado.getTime() - 60000) : null;
    // >>> CAMBIO: la INE de un familiar cuya persona cambió (otro nombre en ese lugar) también debe ser nueva.
    const cambiados = familiaresCambiados_(folio);
    const faltan = documentosRequeridos_(folio).filter(function (r) {
      const nueva = fotoMarcada_(r, corregir) || (!!r.familiar && cambiados.indexOf(r.familiar) !== -1);
      return !existeArchivo_(carpetaEmp, id, r, nueva ? inicio : null);
    });
    if (faltan.length) {
      throw new Error('Faltan documentos: ' + faltan.map(function (r) { return r.etiqueta; }).join(', ') + '.');
    }

    const ahora = new Date();
    const tz = libro_().getSpreadsheetTimeZone();
    guardarFila_(envio.hoja, { FOLIO: folio, ESTADO: ESTADOS.PENDIENTE, FECHA_ENVIO: ahora, CAMPANA: campana_(ahora, tz),
      PDF_EXPEDIENTE: '', DOCS_RH: '' }, false); // >>> CAMBIO: se limpia el link del PDF anterior; el nuevo se escribe enseguida
    borrarDuenosIne_(folio); // >>> CAMBIO: envío terminado; las INE en Drive ya son de las personas guardadas en FAMILIARES
    resultado = { // >>> CAMBIO: antes era "return {…}"; ahora se guarda para hacer el PDF ya sin candado
      ok: true,
      folio: folio,
      fecha: Utilities.formatDate(ahora, tz, 'dd/MM/yyyy HH:mm')
    };
  } finally {
    lock.releaseLock();
  }
  // >>> CAMBIO: el envío YA quedó "Pendiente". El PDF se hace después y NUNCA hace fallar el envío
  // (si falla, se queda sin PDF y se genera después con el menú "Generar PDF de expedientes que faltan").
  try { generarPdfExpediente_(id); } catch (err) { console.log('PDF expediente ' + folio + ': ' + err); registrarErrorPdf_(id, 'finalizarEnvio', err); } // 27/oct (Agente 2): el error ya no se pierde: queda en la BITACORA de accesos (PDF_ERROR)
  return resultado;
}

// ============================================================
// >>> CAMBIO: PDF DE CADA ENVÍO (constancia de lo que mandó el empleado)
// ------------------------------------------------------------
//  - Se genera al terminar cada envío, DESPUÉS de dejarlo "Pendiente" (si falla, el envío no se afecta).
//  - Se guarda en EXPEDIENTES RH / DEPENDENCIA / ID / PDF EXPEDIENTE / ID_EXPEDIENTE_aaaa-mm-dd_hhmm.pdf
//  - Nunca se borran los PDF anteriores: cada envío (y cada corrección) deja el suyo.
//  - El link del último se escribe en CONTROL EXP → PDF_EXPEDIENTE (solo esa celda).
//  - Lleva los datos de las 4 pestañas, la foto de perfil y las fotos de INE / licencia / comprobante de domicilio.
// ============================================================

const CARPETA_PDF_EXP = 'PDF EXPEDIENTE';
const MAX_MB_FOTOS_PDF = 5; // si las fotos juntas pesan más, las que sobran se indican "ver en Drive"

// Nombre bonito de cada columna en el PDF (lo que no esté aquí se muestra con su encabezado).
const ETIQUETAS_PDF = {
  CENTRO_COSTO: 'Centro de costo', FECHA_INGRESO: 'Fecha de ingreso', PUESTO: 'Puesto', TURNO: 'Turno',
  NOMBRE: 'Nombre(s)', APELLIDO_PATERNO: 'Apellido paterno', APELLIDO_MATERNO: 'Apellido materno',
  FECHA_NACIMIENTO: 'Fecha de nacimiento', EDAD: 'Edad', SEXO: 'Sexo', ESTADO_CIVIL: 'Estado civil',
  ESCOLARIDAD: 'Escolaridad', TELEFONO: 'Teléfono', CORREO_PERSONAL: 'Correo personal',
  CALLE_NUMERO: 'Calle y número', COLONIA: 'Colonia', MUNICIPIO: 'Municipio', CODIGO_POSTAL: 'Código postal',
  ESTADO_DOMICILIO: 'Estado', DOMICILIO: 'Domicilio completo', RFC: 'RFC', CURP: 'CURP',
  SERVICIO_MEDICO: 'Servicio médico', SERVICIO_MEDICO_VIGENTE: '¿Servicio médico vigente?', TIPO_SANGRE: 'Tipo de sangre',
  MANEJA: '¿Maneja?', TIPO_LICENCIA: 'Tipo de licencia', ESTATUS_LICENCIA: 'Estatus de la licencia',
  CONTACTO_EMERGENCIA: 'Contacto de emergencia', PARENTESCO_EMERGENCIA: 'Parentesco', TELEFONO_EMERGENCIA: 'Teléfono de emergencia',
  TALLA_CAMISA: 'Talla de camisa', TALLA_OVEROL: 'Talla de overol', TALLA_CALZADO: 'Talla de calzado', LENTES: '¿Usa lentes?',
  NUMERO_HIJOS: 'Número de hijos', NOMBRE_HIJOS: 'Nombre de los hijos', FECHA_NACIMIENTO_HIJOS: 'Fecha de nacimiento de los hijos',
  EDAD_HIJOS: 'Edad de los hijos', PERSONAS_DEPENDIENTES: 'Adultos que viven con él/ella', NOMBRE_ADULTOS: 'Nombre de los adultos',
  EDAD_ADULTOS: 'Edad de los adultos', PARENTESCO_ADULTOS: 'Parentesco de los adultos'
};

/** Genera el PDF del envío actual del empleado y guarda su link. Regresa el link. */
function generarPdfExpediente_(id) {
  id = limpiarId_(id);
  const folio = folio_(id);
  const control = filaPorFolio_(CONFIG.HOJA_EXPEDIENTES, folio);
  if (!control) throw new Error('No existe el folio ' + folio + ' en CONTROL EXP.');
  if (estadoDe_(control.ESTADO) === 'CAPTURA') throw new Error('El envío ' + folio + ' no está terminado.');
  const tz = libro_().getSpreadsheetTimeZone();
  const carpetaEmp = carpetaEmpleado_(String(control.DEPENDENCIA || 'SIN DEPENDENCIA'), id);
  const enviado = aFecha_(control.FECHA_ENVIO) || new Date();
  const nRh = String(control.DOCS_RH || '').split('\n').filter(function (x) { return x.trim(); }).length; // documentos que subió RH
  const nombre = id + '_EXPEDIENTE_' + Utilities.formatDate(enviado, tz, 'yyyy-MM-dd_HHmm') + (nRh ? '_RH' + nRh : '') + '.pdf';
  const carpetaPdf = obtenerOCrearCarpeta_(carpetaEmp, CARPETA_PDF_EXP);

  // Si ya existe el PDF de ESTE envío (misma fecha), se reutiliza: no se duplica.
  let archivo = null;
  const it = carpetaPdf.getFilesByName(nombre);
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) { archivo = f; break; } }
  if (!archivo) {
    const html = htmlPdfExpediente_(id, folio, control, carpetaEmp, tz, enviado);
    archivo = carpetaPdf.createFile(HtmlService.createHtmlOutput(html).getAs(MimeType.PDF).setName(nombre));
  }
  const url = archivo.getUrl();

  // Solo se escribe la celda PDF_EXPEDIENTE de su fila (con candado, como las demás escrituras).
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hoja = obtenerHoja_(CONFIG.HOJA_EXPEDIENTES, ENC_EXPEDIENTES);
    // Se vuelve a revisar con candado: la fila sigue existiendo y es el MISMO envío (no se reenvió mientras).
    const actual = filaPorFolio_(CONFIG.HOJA_EXPEDIENTES, folio);
    const minuto = function (v) { const f = aFecha_(v); return f ? Utilities.formatDate(f, tz, 'yyyyMMddHHmm') : ''; };
    if (!actual || minuto(actual.FECHA_ENVIO) !== minuto(control.FECHA_ENVIO) ||
        String(actual.DOCS_RH || '') !== String(control.DOCS_RH || '')) {
      throw new Error('El envío ' + folio + ' cambió o ya no existe; no se escribe el link.');
    }
    guardarFila_(hoja, { FOLIO: folio, PDF_EXPEDIENTE: url }, false);
  } finally {
    lock.releaseLock();
  }
  // Solo se conserva el PDF más reciente: los demás van a la papelera (se recuperan 30 días)
  const todos = carpetaPdf.getFiles();
  while (todos.hasNext()) {
    const f = todos.next();
    if (f.getId() !== archivo.getId() && !f.isTrashed() && /_EXPEDIENTE_/.test(f.getName())) f.setTrashed(true);
  }
  return url;
}

/** Archivo más reciente de un documento (perfil, INE, licencia, comprobante…) en la carpeta del empleado, o null. */
function archivoDocumento_(carpetaEmp, id, m) {
  const it = carpetaEmp.getFoldersByName(nombreSubcarpeta_(m));
  if (!it.hasNext()) return null;
  const base = nombreArchivo_(id, m) + '.';
  const archivos = it.next().getFiles();
  let mejor = null;
  while (archivos.hasNext()) {
    const f = archivos.next();
    if (f.isTrashed() || f.getName().indexOf(base) !== 0) continue;
    if (!mejor || f.getDateCreated() > mejor.getDateCreated()) mejor = f;
  }
  return mejor;
}

function htmlPdfExpediente_(id, folio, control, carpetaEmp, tz, enviado) {
  const esc = function (t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  };
  const texto = function (col, v) {
    if (esFecha_(v)) return Utilities.formatDate(v, tz, /^FECHA_(NACIMIENTO|INGRESO)$/.test(col) ? 'dd/MM/yyyy' : 'dd/MM/yyyy HH:mm');
    return String(v == null ? '' : v).replace(/^'/, '').trim();
  };
  const filaHtml = function (k, v) {
    return '<tr><td class="k">' + esc(k) + '</td><td class="v">' + (v === '' ? '<span class="na">—</span>' : esc(v)) + '</td></tr>';
  };
  let bytesFotos = 0;
  const imagen = function (archivo, ancho) {
    if (!archivo) return '<div class="nf">No se encontró en Drive</div>';
    const tipo = String(archivo.getMimeType() || '');
    if (tipo.indexOf('image/') !== 0) return '<div class="nf">Se entregó como PDF (ver en la carpeta de Drive)</div>';
    if (bytesFotos + archivo.getSize() > MAX_MB_FOTOS_PDF * 1024 * 1024) return '<div class="nf">Foto muy pesada para el PDF (ver en la carpeta de Drive)</div>';
    const bytes = archivo.getBlob().getBytes();
    if (bytesFotos + bytes.length > MAX_MB_FOTOS_PDF * 1024 * 1024) return '<div class="nf">Foto muy pesada para el PDF (ver en la carpeta de Drive)</div>';
    bytesFotos += bytes.length;
    return '<img src="data:' + tipo + ';base64,' + Utilities.base64Encode(bytes) + '" style="width:' + ancho + 'px">';
  };

  // Datos de control + foto de perfil
  const sinIne = String(control.INE_NO_ENTREGADA || '').trim().replace(/\bCOMPROBANTE\b/g, 'COMPROBANTE DE DOMICILIO'); // >>> CAMBIO: texto legible
  const sinComprobante = /COMPROBANTE/.test(String(control.INE_NO_ENTREGADA || '')); // >>> CAMBIO
  const nombreCompleto = texto('', control.NOMBRE_COMPLETO);
  const filasControl = [
    filaHtml('ID del prestador', id), filaHtml('Nombre completo', nombreCompleto), filaHtml('Folio', folio),
    filaHtml('Dependencia', texto('', control.DEPENDENCIA)), filaHtml('Campaña', texto('', control.CAMPANA)),
    filaHtml('Fecha de envío', Utilities.formatDate(enviado, tz, 'dd/MM/yyyy HH:mm')),
    filaHtml('Documentos que no tenía a la mano', sinIne),
    filaHtml('¿Su INE está vigente?', texto('', control.INE_VIGENTE)),
    // >>> CAMBIO: se quitó "¿INE de familiares vigente?" (ya no se piden INE de familiares)
    filaHtml('¿Dirección de la INE coincide con el comprobante?', texto('', control.DOM_COINCIDE_INE)),
    filaHtml('¿El comprobante es donde vive actualmente?', texto('', control.DOM_COMPROBANTE_ACTUAL))
  ].join('');
  const perfil = archivoDocumento_(carpetaEmp, id, { tipo: 'FOTO_PERFIL', familiar: '', lado: '' });
  let cuerpo = '<div class="sec">DATOS DE CONTROL</div><table class="t"><tr><td style="padding:0;border:none">' +
    '<table class="t" style="border:none">' + filasControl + '</table></td>' +
    '<td class="perfil">' + imagen(perfil, 130) + '</td></tr></table>';

  // Las 4 pestañas
  const omitir = ['FOLIO', 'ID_EMPLEADO', 'NOMBRE_COMPLETO', 'CARPETA_DRIVE'];
  SECCIONES.forEach(function (s, i) {
    const fila = filaPorFolio_(s.hoja, folio) || {};
    const filas = s.columnas.filter(function (c) { return omitir.indexOf(c) === -1; })
      .map(function (c) { return filaHtml(ETIQUETAS_PDF[c] || c.replace(/_/g, ' '), texto(c, fila[c])); }).join('');
    cuerpo += '<div class="sec">' + (i + 1) + '. ' + esc(s.hoja) + '</div><table class="t">' + filas + '</table>';
  });

  // Fotos de documentos (de dos en dos: frente y reverso)
  const docs = documentosRequeridos_(folio).filter(function (r) { return r.tipo !== 'FOTO_PERFIL'; });
  cuerpo += '<div class="sec">' + (SECCIONES.length + 1) + '. DOCUMENTOS</div><table class="t docs">';
  if (!docs.length && !sinComprobante) cuerpo += '<tr><td class="na">No se requirieron documentos además de la foto de perfil.</td></tr>';
  for (let i = 0; i < docs.length; i += 2) {
    cuerpo += '<tr>' + [docs[i], docs[i + 1]].map(function (r) {
      if (!r) return '<td></td>';
      return '<td class="doc"><div class="dt">' + esc(r.etiqueta) + '</div>' + imagen(archivoDocumento_(carpetaEmp, id, r), 250) + '</td>';
    }).join('') + '</tr>';
  }
  // >>> CAMBIO: si no entregó el comprobante, el PDF lo indica claramente
  if (sinComprobante) cuerpo += '<tr><td class="doc" colspan="2"><div class="dt">Comprobante de domicilio</div><div class="nf">NO ENTREGADO: el empleado indicó que no lo tenía a la mano</div></td></tr>';
  cuerpo += '</table>';
  if (sinIne) cuerpo += '<div class="nota">Documentos no entregados (no los tenía a la mano): ' + esc(sinIne) + '.</div>';

  return '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#22252B;margin:0}' +
    '.cab{border-bottom:2px solid #E8732A;padding:0 0 8px;margin-bottom:6px}' +
    '.cab td{vertical-align:middle}.marca{color:#E8732A;font-weight:bold;font-size:16px}' +
    '.titulo{font-size:19px;font-weight:bold;text-align:center}.rh{font-size:9px;color:#6B7280;text-align:right}' +
    '.subt{text-align:center;color:#6B7280;font-size:10px;margin:4px 0 12px}' +
    '.sec{background:#E8732A;color:#fff;font-weight:bold;font-size:12px;padding:6px 10px;border-radius:5px 5px 0 0;margin-top:12px}' +
    'table{border-collapse:collapse;width:100%}table.t{border:1px solid #E7E2DC}' +
    '.t td{border-bottom:1px solid #EFEBE6;padding:5px 8px;vertical-align:top}' +
    '.k{width:42%;font-weight:bold;color:#374151}.v{color:#111}.na{color:#9CA3AF}' +
    '.perfil{width:150px;text-align:center;vertical-align:middle;border-left:1px solid #EFEBE6}' +
    '.docs tr{page-break-inside:avoid}.doc{width:50%;text-align:center;padding:8px}' +
    '.dt{font-weight:bold;color:#374151;margin-bottom:5px}.nf{color:#9CA3AF;padding:30px 0}' +
    '.nota{margin-top:6px;font-size:9.5px;color:#C05A15}' +
    '.pie{margin-top:14px;font-size:8.5px;color:#6B7280;border-top:1px solid #E7E2DC;padding-top:6px}' +
    '</style></head><body>' +
    '<table class="cab"><tr><td class="marca" style="width:25%">LIMPIALEÓN</td><td class="titulo">EXPEDIENTE DEL PRESTADOR</td>' +
    '<td class="rh" style="width:25%">RECURSOS HUMANOS<br>' + esc(folio) + '</td></tr></table>' +
    '<div class="subt">Actualización de expediente – ' + esc(nombreCompleto) + ' · Enviado el ' +
    esc(Utilities.formatDate(enviado, tz, 'dd/MM/yyyy HH:mm')) + '</div>' +
    cuerpo +
    '<div class="pie">Documento confidencial: contiene datos personales. Información declarada por el prestador de servicios ' +
    'el ' + esc(Utilities.formatDate(enviado, tz, 'dd/MM/yyyy HH:mm')) + '. Uso exclusivo de Recursos Humanos.</div></body></html>';
}

/**
 * Menú "LimpiaLeón RH" → Generar PDF de expedientes que faltan (o correrla desde el editor).
 * Hace el PDF de cada envío terminado que todavía no tiene PDF_EXPEDIENTE. No toca nada más.
 * Si son muchos, se detiene a los ~4.5 minutos: vuelve a correrla y sigue donde se quedó.
 */
function rhGenerarPdfsExpedientes() {
  verificarAccesoAdministrador_(); // solo desde la hoja o el editor (nunca desde la página de empleados)
  const inicio = Date.now();
  const hoja = obtenerHoja_(CONFIG.HOJA_EXPEDIENTES, ENC_EXPEDIENTES); // agrega la columna PDF_EXPEDIENTE si falta
  const t = leerTabla_(hoja);
  const cId = t.encabezados.indexOf('ID_EMPLEADO'), cEst = t.encabezados.indexOf('ESTADO'), cPdf = t.encabezados.indexOf('PDF_EXPEDIENTE');
  const pendientes = t.filas.filter(function (f) {
    const est = estadoDe_(f[cEst]);
    return String(f[cId] || '').trim() && est && est !== 'CAPTURA' && !String(f[cPdf] || '').trim();
  }).map(function (f) { return limpiarId_(f[cId]); });
  let hechos = 0;
  const errores = [];
  for (let i = 0; i < pendientes.length; i++) {
    if (Date.now() - inicio > 270000) break;
    try { generarPdfExpediente_(pendientes[i]); hechos++; } catch (e) { errores.push(pendientes[i] + ': ' + (e && e.message ? e.message : e)); }
  }
  const faltan = pendientes.length - hechos - errores.length;
  const msg = 'PDF generados: ' + hechos + ' de ' + pendientes.length + '.' +
    (faltan > 0 ? '\nFaltan ' + faltan + ': vuelve a correrla para seguir.' : '') +
    (errores.length ? '\nNo se pudieron hacer:\n' + errores.slice(0, 15).join('\n') : '');
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

// ============================================================
// ACCESO CON PIN
// ============================================================
//  - La primera vez, el empleado confirma que es él con los últimos 4 caracteres de su clave de elector,
//    su RFC o su CURP (se comparan contra BD_MAESTRA_RH, nunca contra lo que capture en el portal)
//    y crea un PIN de 4 números.
//  - Después entra con número de empleado + PIN. Si lo olvida, repite la confirmación y crea uno nuevo.
//  - Los PIN se guardan cifrados en un archivo APARTE (CONFIG.ACCESOS_ID). Nadie puede leerlos, ni RH.
//  - Al entrar se entrega una "sesión" temporal; todas las funciones del expediente la exigen.
//  - RH administra las cuentas desde el menú "LimpiaLeón RH" de la hoja (asignar PIN, desbloquear, etc.).

const ACCESO = {
  HOJA_ACCESOS: 'ACCESOS',
  HOJA_BITACORA: 'BITACORA',
  INTENTOS_ESPERA: 5,       // del 5º error en adelante hay que esperar (escala tipo iPhone)
  MINUTOS_ESPERA: 15,       // (ya no se usa; se deja por compatibilidad)
  ESCALA_ESPERAS_MIN: [5, 60, 480, 1440], // error 5: 5 min · 6: 1 h · 7: 8 h · 8: 24 h
  INTENTOS_BLOQUEO: 9,      // error 9 → cuenta bloqueada hasta que RH la libere
  DIAS_OLVIDAR_ERRORES: 30, // los errores se olvidan tras 30 días sin equivocarse
  MINUTOS_REVISAR_SESION: 5, // cada cuánto una sesión abierta revisa si el PIN cambió o la cuenta se bloqueó
  HORAS_SESION: 6,          // sesión del portal (máximo que permite Google: 6 horas)
  MINUTOS_PERMISO_PIN: 15   // tiempo para crear el PIN después de confirmar el documento
};

const ENC_ACCESOS = ['ID_EMPLEADO', 'NOMBRE', 'ESTADO', 'ORIGEN_PIN', 'ASIGNADO_POR', 'FECHA_ACTIVACION',
  'FECHA_CAMBIO_PIN', 'ULTIMO_ACCESO', 'INTENTOS_PIN', 'INTENTOS_DOC', 'ESPERA_HASTA', 'SESIONES_DESDE',
  'PIN_HASH', 'SAL', 'ULTIMO_FALLO'];
const ENC_BITACORA = ['FECHA', 'ID_EMPLEADO', 'EVENTO', 'DETALLE', 'USUARIO'];
const EST_ACCESO = { SIN_ACTIVAR: 'SIN ACTIVAR', ACTIVO: 'ACTIVO', BLOQUEADO: 'BLOQUEADO' };

// Documentos para confirmar identidad, en el orden en que se ofrecen.
const DOCUMENTOS_ACCESO = [
  { tipo: 'ELECTOR', nombre: 'tu clave de elector', formato: /^[A-Z0-9]{18}$/,
    columna: function (h) { return h.indexOf('ELECTOR') !== -1; } },
  { tipo: 'RFC', nombre: 'tu RFC', formato: /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/,
    columna: function (h) { return h === 'RFC'; } },
  { tipo: 'CURP', nombre: 'tu CURP', formato: /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d$/,
    columna: function (h) { return h === 'CURP'; } }
];

const MSG_SESION = 'SESION_TERMINADA: Tu sesión terminó por seguridad. Vuelve a escribir tu PIN para continuar.';
const MSG_PERMISO = 'PERMISO_VENCIDO: Pasó mucho tiempo. Vuelve a confirmar tu documento para crear tu PIN.';

/** Paso 1: el empleado escribe su número. Solo dice si existe y qué tiene que hacer (no entrega datos). */
function iniciarAcceso(idCapturado) {
  const id = limpiarId_(idCapturado);
  if (!id) return { ok: false, motivo: 'ID_VACIO' };
  if (!formatoIdValido_(id)) return { ok: false, motivo: 'NO_ENCONTRADO' }; // formato incorrecto: igual que no encontrado
  if (esUsuarioPrueba_(id)) return { ok: true, acceso: 'PRUEBA', nombre: 'Usuario de prueba', documentos: [] };
  const emp = obtenerEmpleadoMaestro_(id);
  if (!emp) return { ok: false, motivo: 'NO_ENCONTRADO' };
  const cuenta = cuentaDe_(id);
  const r = {
    ok: true,
    nombre: nombreSaludo_(emp),
    documentos: documentosDe_(emp).map(function (d) { return d.tipo; })
  };
  const bloqueo = bloqueoDe_(cuenta);
  if (bloqueo) return Object.assign(r, bloqueo);
  r.acceso = tienePin_(cuenta) ? 'ACTIVO' : 'SIN_ACTIVAR';
  return r;
}

/** Activar o recuperar: compara los últimos 4 caracteres del documento elegido. */
function verificarDocumento(idCapturado, tipo, ultimos) {
  return conCandado_(function () {
    const id = limpiarId_(idCapturado);
    const emp = obtenerEmpleadoMaestro_(id);
    if (!emp) throw new Error('El número de prestador de servicio no es válido.');
    const doc = documentosDe_(emp).filter(function (d) { return d.tipo === String(tipo); })[0];
    if (!doc) throw new Error('Ese documento no está registrado. Elige otro.');
    const escrito = limpiarDoc_(ultimos);
    if (escrito.length !== 4) return { ok: false, mensaje: 'Escribe exactamente 4 caracteres.' };

    const cuenta = cuentaDe_(id) || crearCuenta_(id, emp);
    const bloqueo = bloqueoDe_(cuenta);
    if (bloqueo) return Object.assign({ ok: false }, bloqueo);

    if (escrito === doc.valor.slice(-4)) {
      guardarCuenta_(cuenta, { INTENTOS_DOC: 0 });
      bitacora_(id, 'DOCUMENTO_CORRECTO', doc.tipo);
      return { ok: true, permiso: emitirPermiso_(id) };
    }
    return fallo_(cuenta, 'INTENTOS_DOC', 'DOCUMENTO_INCORRECTO', doc.tipo,
      'Esos 4 caracteres no coinciden con ' + doc.nombre + '. Revísalos en tu documento.');
  });
}

/** Crea (o recupera) el PIN después de confirmar el documento. Deja la sesión abierta. */
function crearPin(idCapturado, permiso, pin) {
  return conCandado_(function () {
    const id = limpiarId_(idCapturado);
    if (!permisoValido_(permiso, id)) throw new Error(MSG_PERMISO);
    const emp = obtenerEmpleadoMaestro_(id);
    if (!emp) throw new Error('El número de prestador de servicio no es válido.');
    const problema = problemaPin_(pin, emp);
    if (problema) return { ok: false, mensaje: problema };

    const cuenta = cuentaDe_(id) || crearCuenta_(id, emp);
    if (estadoAcceso_(cuenta) === EST_ACCESO.BLOQUEADO) return { ok: false, acceso: 'BLOQUEADO' };
    const recuperado = tienePin_(cuenta);
    const ahora = new Date();
    const sal = Utilities.getUuid();
    guardarCuenta_(cuenta, {
      NOMBRE: nombreCompleto_(emp),
      ESTADO: EST_ACCESO.ACTIVO,
      ORIGEN_PIN: recuperado ? 'CAMBIADO POR EL EMPLEADO' : 'CREADO POR EL EMPLEADO',
      ASIGNADO_POR: '',
      FECHA_ACTIVACION: aFecha_(cuenta.FECHA_ACTIVACION) || ahora,
      FECHA_CAMBIO_PIN: ahora,
      ULTIMO_ACCESO: ahora,
      INTENTOS_PIN: 0,
      INTENTOS_DOC: 0,
      ESPERA_HASTA: '',
      SESIONES_DESDE: ahora,
      PIN_HASH: hashPin_(String(pin).trim(), sal),
      SAL: sal
    });
    revocarSesiones_(id);
    consumirPermiso_(permiso);
    bitacora_(id, recuperado ? 'PIN_RECUPERADO' : 'CUENTA_ACTIVADA', '');
    return { ok: true, sesion: emitirSesion_(id) };
  });
}

/** Entrar con número de empleado + PIN. */
function entrar(idCapturado, pin) {
  return conCandado_(function () {
    const id = limpiarId_(idCapturado);
    const cuenta = cuentaDe_(id);
    if (!tienePin_(cuenta)) {
      const bloqueo = bloqueoDe_(cuenta);
      return bloqueo ? Object.assign({ ok: false }, bloqueo) : { ok: false, acceso: 'SIN_ACTIVAR' };
    }
    const bloqueo = bloqueoDe_(cuenta);
    if (bloqueo) return Object.assign({ ok: false }, bloqueo);
    pin = String(pin == null ? '' : pin).trim();
    if (!/^\d{4}$/.test(pin)) return { ok: false, mensaje: 'Tu PIN son 4 números.' };

    if (hashPin_(pin, String(cuenta.SAL)) === String(cuenta.PIN_HASH)) {
      guardarCuenta_(cuenta, { INTENTOS_PIN: 0, ULTIMO_ACCESO: new Date() });
      bitacora_(id, 'ENTRADA', 'PORTAL');
      return { ok: true, sesion: emitirSesion_(id) };
    }
    return fallo_(cuenta, 'INTENTOS_PIN', 'PIN_INCORRECTO', '', 'El PIN no es correcto.');
  });
}

/** Ya con sesión: regresa el expediente (lo que antes hacía buscarEmpleado). */
function cargarExpediente(sesion) {
  return datosExpediente_(idDeSesion_(sesion));
}

/** Usuario de prueba (CONFIG.USUARIO_PRUEBA): no existe en la base y nunca guarda nada. */
function esUsuarioPrueba_(id) {
  return !!String(CONFIG.USUARIO_PRUEBA || '').trim() && limpiarId_(id) === limpiarId_(CONFIG.USUARIO_PRUEBA);
}

/** Expediente de ejemplo para el usuario de prueba. No lee ni escribe nada de las hojas. */
function cargarExpedientePrueba() {
  if (!String(CONFIG.USUARIO_PRUEBA || '').trim()) throw new Error('El usuario de prueba está desactivado.');
  const d = { ID_EMPLEADO: limpiarId_(CONFIG.USUARIO_PRUEBA) };
  CAMPOS_EDITABLES.forEach(function (c) { d[c] = ''; });
  // Algunos datos de ejemplo para ver cómo se confirma "¿Es correcto? Sí / No".
  Object.assign(d, { CENTRO_COSTO: 'LIMPIALEON', PUESTO: 'AYUDANTE GENERAL', TURNO: 'DIA',
    NOMBRE: 'USUARIO', APELLIDO_PATERNO: 'DE', APELLIDO_MATERNO: 'PRUEBA', NUMERO_HIJOS: '', PERSONAS_DEPENDIENTES: '' });
  return {
    ok: true, prueba: true, estado: 'NUEVO', observaciones: '', datos: d, hijos: [], adultos: [],
    fotosExistentes: [], corregir: [], sinIne: [], opciones: OPCIONES,
    maxHijos: CONFIG.MAX_HIJOS, maxAdultos: CONFIG.MAX_ADULTOS
  };
}

/** Al salir de la página. */
function cerrarSesion(sesion) {
  const s = String(sesion || '');
  if (s) CacheService.getScriptCache().remove('ses_' + huella_(s));
  return { ok: true };
}

// ---------- Reglas ----------

/** Un error más: cuenta el intento y aplica la escala de esperas (como el iPhone).
 *  Errores 1-4: puede volver a intentar.  5: espera 5 min · 6: 1 hora · 7: 8 horas · 8: 24 horas.
 *  9: cuenta BLOQUEADA hasta que RH la libere.  Los errores se olvidan tras 30 días sin equivocarse.
 *  Los errores de PIN y los del documento se cuentan por separado. */
function fallo_(cuenta, campo, evento, detalle, mensaje) {
  // Se vuelve a leer la cuenta justo ahora: si la persona también se equivocó en otra página
  // (PIN, salud o datos) al mismo tiempo, esos errores cuentan y no se pierden.
  const reciente = cuentaDe_(cuenta.ID_EMPLEADO);
  if (reciente) Object.assign(cuenta, reciente);
  const previos = erroresVigentes_(cuenta, campo);
  const n = previos + 1;
  const cambios = {};
  // Primer error con las reglas nuevas, o errores de hace más de 30 días: los DOS contadores (PIN y
  // documento) se ajustan juntos; si no, el otro contador volvería con su valor viejo completo.
  if (!aFecha_(cuenta.ULTIMO_FALLO) || erroresOlvidados_(cuenta)) {
    cambios.INTENTOS_PIN = erroresVigentes_(cuenta, 'INTENTOS_PIN');
    cambios.INTENTOS_DOC = erroresVigentes_(cuenta, 'INTENTOS_DOC');
  }
  cambios[campo] = n;
  cambios.ULTIMO_FALLO = new Date();
  if (n >= ACCESO.INTENTOS_BLOQUEO) {
    cambios.ESTADO = EST_ACCESO.BLOQUEADO;
    guardarCuenta_(cuenta, cambios);
    bitacora_(cuenta.ID_EMPLEADO, evento, detalle);
    bitacora_(cuenta.ID_EMPLEADO, 'CUENTA_BLOQUEADA', n + ' intentos equivocados');
    return { ok: false, acceso: 'BLOQUEADO' };
  }
  if (n >= ACCESO.INTENTOS_ESPERA) {
    const escala = ACCESO.ESCALA_ESPERAS_MIN;
    const minutos = escala[Math.min(n - ACCESO.INTENTOS_ESPERA, escala.length - 1)];
    cambios.ESPERA_HASTA = new Date(Date.now() + minutos * 60000);
    guardarCuenta_(cuenta, cambios);
    bitacora_(cuenta.ID_EMPLEADO, evento, detalle);
    bitacora_(cuenta.ID_EMPLEADO, 'ESPERA', minutos + ' minutos (error ' + n + ')');
    return { ok: false, acceso: 'ESPERA', minutos: minutos, ultima: n >= ACCESO.INTENTOS_BLOQUEO - 1 };
  }
  guardarCuenta_(cuenta, cambios);
  bitacora_(cuenta.ID_EMPLEADO, evento, detalle);
  return { ok: false, mensaje: mensaje, restantes: ACCESO.INTENTOS_ESPERA - n };
}

/** null si puede intentar; si no, { acceso: 'BLOQUEADO' } o { acceso: 'ESPERA', minutos }. */
/** Errores que cuentan para la escala nueva. Las cuentas con errores de las reglas anteriores
 *  (sin fecha en ULTIMO_FALLO) siguen donde iban dentro de su grupo de 5, como antes: no se les castiga de más. */
function erroresVigentes_(cuenta, campo) {
  if (erroresOlvidados_(cuenta)) return 0; // más de 30 días sin equivocarse: se olvidan los DOS contadores
  const n = Number(cuenta[campo]) || 0;
  if (n && !aFecha_(cuenta.ULTIMO_FALLO)) return n % ACCESO.INTENTOS_ESPERA;
  return n;
}

/** true si el último error fue hace más de 30 días (entonces ya no cuenta ningún error). */
function erroresOlvidados_(cuenta) {
  const ultimo = aFecha_(cuenta.ULTIMO_FALLO) || aFecha_(cuenta.ESPERA_HASTA);
  return !!(ultimo && Date.now() - ultimo.getTime() > ACCESO.DIAS_OLVIDAR_ERRORES * 86400000);
}

function bloqueoDe_(cuenta) {
  if (!cuenta) return null;
  if (estadoAcceso_(cuenta) === EST_ACCESO.BLOQUEADO) return { acceso: 'BLOQUEADO' };
  const hasta = aFecha_(cuenta.ESPERA_HASTA);
  if (hasta && hasta.getTime() > Date.now()) {
    const errores = Math.max(erroresVigentes_(cuenta, 'INTENTOS_PIN'), erroresVigentes_(cuenta, 'INTENTOS_DOC'));
    return { acceso: 'ESPERA', minutos: Math.max(1, Math.ceil((hasta.getTime() - Date.now()) / 60000)),
      ultima: errores >= ACCESO.INTENTOS_BLOQUEO - 1 };
  }
  return null;
}

function estadoAcceso_(cuenta) {
  const s = simplificar_(cuenta && cuenta.ESTADO);
  if (s === 'BLOQUEADO' || s === 'BLOQUEADA') return EST_ACCESO.BLOQUEADO;
  if (s === 'ACTIVO' || s === 'ACTIVA') return EST_ACCESO.ACTIVO;
  return EST_ACCESO.SIN_ACTIVAR;
}

function tienePin_(cuenta) {
  const hash = String((cuenta && cuenta.PIN_HASH) || '').trim();
  // Un PIN_HASH dañado (#ERROR!, #NAME?… de versiones anteriores) se toma como "sin PIN":
  // la persona crea uno nuevo en vez de equivocarse hasta quedar bloqueada.
  return !!(cuenta && hash && hash.charAt(0) !== '#' && String(cuenta.SAL || '').trim()
    && estadoAcceso_(cuenta) !== EST_ACCESO.SIN_ACTIVAR);
}

/** Texto del problema, o '' si el PIN sirve. */
function problemaPin_(pin, emp) {
  pin = String(pin == null ? '' : pin).trim();
  if (!/^\d{4}$/.test(pin)) return 'El PIN deben ser 4 números.';
  if (/^(\d)\1{3}$/.test(pin) || '0123456789'.indexOf(pin) !== -1 || '9876543210'.indexOf(pin) !== -1) {
    return 'Ese PIN es muy fácil de adivinar (como 1234 o 0000). Elige otro.';
  }
  const f = emp ? valorOriginal_(emp, 'FECHA_NACIMIENTO', libro_().getSpreadsheetTimeZone()) : '';
  const p = String(f).split('-');
  if (p.length === 3 && [p[0], p[2] + p[1], p[1] + p[2]].indexOf(pin) !== -1) {
    return 'No uses tu año ni tu fecha de nacimiento: es lo primero que alguien intentaría. Elige otro.';
  }
  return '';
}

/** Documentos con formato válido en la BD, en orden: clave de elector, RFC, CURP. */
function documentosDe_(emp) {
  const claves = Object.keys(emp).filter(function (k) { return k !== '_fila'; });
  const r = [];
  DOCUMENTOS_ACCESO.forEach(function (d) {
    const valor = claves.filter(function (k) { return d.columna(simplificar_(k)); })
      .map(function (k) { return limpiarDoc_(emp[k]); })
      .filter(function (v) { return d.formato.test(v); })[0];
    if (valor) r.push({ tipo: d.tipo, nombre: d.nombre, valor: valor });
  });
  return r;
}

function limpiarDoc_(v) {
  return String(v == null ? '' : v).toUpperCase().replace(/[\s\-.]/g, '');
}

/**
 * Nombre para saludar: los dos nombres ("Juan Carlos", "María de los Ángeles").
 * Si solo tiene un nombre, se agrega su segundo apellido ("Juan Gómez"); si no tiene, el primero.
 */
function nombreSaludo_(emp) {
  const particulas = ['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'MA.', 'MA'];
  const nombres = String(emp.NOMBRE || '').trim().toUpperCase().split(/\s+/).filter(String);
  let partes = nombres.slice(0, 1);
  // Segundo nombre completo, con sus partículas ("DE LOS ÁNGELES").
  for (let i = 1; i < nombres.length; i++) {
    partes.push(nombres[i]);
    if (particulas.indexOf(nombres[i]) === -1) break;
  }
  if (partes.length < 2) {
    const apellido = String(emp.APELLIDO_MATERNO || '').trim() || String(emp.APELLIDO_PATERNO || '').trim();
    if (apellido) partes = partes.concat(apellido.toUpperCase().split(/\s+/));
  }
  return partes.map(function (p, i) {
    if (i > 0 && ['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y'].indexOf(p) !== -1) return p.toLowerCase();
    return p.charAt(0) + p.slice(1).toLowerCase();
  }).join(' ');
}

function nombreCompleto_(emp) {
  return [emp.NOMBRE, emp.APELLIDO_PATERNO, emp.APELLIDO_MATERNO]
    .map(function (x) { return String(x || '').trim(); }).filter(String).join(' ').toUpperCase();
}

// ---------- Cifrado, sesiones y permisos ----------

/** Clave secreta del sistema (no está en ninguna hoja). Si se borra, todos tendrían que recuperar su PIN. */
function pimienta_(crearSiFalta) {
  const props = PropertiesService.getScriptProperties();
  let p = props.getProperty('PIMIENTA_PIN');
  // Solo configurarAccesos() la crea. Si faltara en uso normal NO se inventa una nueva
  // (eso haría que todos los PIN dejaran de servir en las 3 páginas).
  if (!p && !crearSiFalta) throw new Error('Falta la clave PIMIENTA_PIN en las propiedades del proyecto. Avísale a RH.');
  if (!p) {
    p = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('PIMIENTA_PIN', p);
  }
  return p;
}

function hashPin_(pin, sal) {
  return Utilities.base64Encode(Utilities.computeHmacSha256Signature(sal + ':' + pin, pimienta_()));
}

function huella_(texto) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto), Utilities.Charset.UTF_8));
}

function emitirSesion_(id) {
  const cache = CacheService.getScriptCache();
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  // Siempre posterior a la última vez que se cerraron sus sesiones (aunque sea el mismo milisegundo).
  const t = Math.max(Date.now(), Number(cache.get('rev_' + id) || 0) + 1);
  cache.put('ses_' + huella_(token), JSON.stringify({ id: id, t: t }), ACCESO.HORAS_SESION * 3600);
  return token;
}

/** Número de empleado de la sesión. Si ya no sirve, lanza MSG_SESION (la página pide el PIN otra vez). */
function idDeSesion_(sesion) {
  const s = String(sesion || '');
  if (s.length < 60) throw new Error(MSG_SESION);
  const cache = CacheService.getScriptCache();
  const clave = 'ses_' + huella_(s);
  const guardado = cache.get(clave);
  if (!guardado) throw new Error(MSG_SESION);
  const d = JSON.parse(guardado);
  const revocadas = Number(cache.get('rev_' + d.id) || 0);
  if (d.t <= revocadas) { cache.remove(clave); throw new Error(MSG_SESION); }
  // >>> Cada pocos minutos revisa en ACCESOS (compartido por las 3 páginas) si el PIN
  // cambió, si RH cerró sus sesiones o si la cuenta se bloqueó, aunque haya sido en otra página.
  if (Date.now() - Number(d.c || d.t) > ACCESO.MINUTOS_REVISAR_SESION * 60000) {
    const cuenta = cuentaDe_(d.id);
    const desde = cuenta ? aFecha_(cuenta.SESIONES_DESDE) : null;
    if (!cuenta || !tienePin_(cuenta) || estadoAcceso_(cuenta) === EST_ACCESO.BLOQUEADO ||
        (desde && desde.getTime() - 2000 > d.t)) {
      cache.remove(clave);
      throw new Error(MSG_SESION);
    }
    d.c = Date.now();
  }
  cache.put(clave, JSON.stringify(d), ACCESO.HORAS_SESION * 3600); // se renueva mientras la use
  return d.id;
}

/** Invalida todas las sesiones abiertas de un empleado (cambio de PIN, RH cierra sesiones, etc.). */
function revocarSesiones_(id) {
  const cache = CacheService.getScriptCache();
  const antes = Number(cache.get('rev_' + id) || 0);
  cache.put('rev_' + id, String(Math.max(Date.now(), antes + 1)), 21600);
}

function emitirPermiso_(id) {
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  CacheService.getScriptCache().put('perm_' + huella_(token), id, ACCESO.MINUTOS_PERMISO_PIN * 60);
  return token;
}

function permisoValido_(permiso, id) {
  const s = String(permiso || '');
  return s.length >= 60 && CacheService.getScriptCache().get('perm_' + huella_(s)) === id;
}

function consumirPermiso_(permiso) {
  CacheService.getScriptCache().remove('perm_' + huella_(String(permiso || '')));
}

function conCandado_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- Archivo de ACCESOS (aparte) ----------

function idAccesos_() {
  const id = String(CONFIG.ACCESOS_ID || '').trim() || PropertiesService.getScriptProperties().getProperty('ACCESOS_ID');
  if (!id) throw new Error('Falta configurar la base de accesos: pega su ID en CONFIG.ACCESOS_ID.');
  return id;
}

let libroAccesosCache_ = null;
function libroAccesos_() {
  if (!libroAccesosCache_) libroAccesosCache_ = SpreadsheetApp.openById(idAccesos_());
  return libroAccesosCache_;
}

/** Pestaña del archivo de accesos; la crea con sus encabezados si no existe y agrega los que falten. */
const hojasAccesosCache_ = {};
function hojaAccesos_(nombre, encabezados) {
  if (hojasAccesosCache_[nombre]) return hojasAccesosCache_[nombre];
  hojasAccesosCache_[nombre] = hojaAccesosSinCache_(nombre, encabezados);
  return hojasAccesosCache_[nombre];
}

function hojaAccesosSinCache_(nombre, encabezados) {
  const ss = libroAccesos_();
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) hoja = ss.insertSheet(nombre);
  if (hoja.getLastRow() === 0) {
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold');
    hoja.setFrozenRows(1);
    return hoja;
  }
  const actuales = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  const faltan = encabezados.filter(function (e) { return actuales.indexOf(e) === -1; });
  if (faltan.length) {
    // Nunca debe impedir entrar: si no se puede agregar, el sistema sigue funcionando sin esa columna.
    try {
      const necesarias = actuales.length + faltan.length;
      if (hoja.getMaxColumns && hoja.getMaxColumns() < necesarias) hoja.insertColumnsAfter(hoja.getMaxColumns(), necesarias - hoja.getMaxColumns());
      hoja.getRange(1, actuales.length + 1, 1, faltan.length).setValues([faltan]).setFontWeight('bold');
    } catch (e) { Logger.log('No se pudo agregar ' + faltan.join(', ') + ' a ' + nombre + ': ' + e); }
  }
  return hoja;
}

function cuentaDe_(id) {
  if (!id) return null;
  const hoja = hojaAccesos_(ACCESO.HOJA_ACCESOS, ENC_ACCESOS);
  if (hoja.getLastRow() < 2) return null;
  const t = leerTabla_(hoja);
  const col = t.encabezados.indexOf('ID_EMPLEADO');
  for (let i = 0; i < t.filas.length; i++) {
    if (limpiarId_(t.filas[i][col]) === id) {
      const c = aObjeto_(t.encabezados, t.filas[i], i + 2);
      c.ID_EMPLEADO = id;
      return c;
    }
  }
  return null;
}

function crearCuenta_(id, emp) {
  const hoja = hojaAccesos_(ACCESO.HOJA_ACCESOS, ENC_ACCESOS);
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  const datos = { ID_EMPLEADO: id, NOMBRE: nombreCompleto_(emp), ESTADO: EST_ACCESO.SIN_ACTIVAR, INTENTOS_PIN: 0, INTENTOS_DOC: 0 };
  hoja.appendRow(enc.map(function (h) { return Object.prototype.hasOwnProperty.call(datos, h) ? textoAcceso_(datos[h]) : ''; }));
  return cuentaDe_(id);
}

/** Texto que Sheets tomaría como fórmula (= + - @) se guarda como texto.
 *  Evita que un PIN cifrado que empieza con "+" se guarde como #ERROR!. */
function textoAcceso_(v) {
  return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
}

/** Cambia SOLO las celdas indicadas de la cuenta.
 *  Antes se reescribía la fila completa: si otra página (PIN, salud o datos) cambiaba la misma cuenta
 *  en ese instante, su cambio se perdía (ej. un PIN nuevo). Ahora cada página toca solo lo suyo.
 *  También revisa que la fila siga siendo de esta persona (por si alguien ordenó la hoja ACCESOS). */
function guardarCuenta_(cuenta, cambios) {
  const hoja = hojaAccesos_(ACCESO.HOJA_ACCESOS, ENC_ACCESOS);
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  const colId = enc.indexOf('ID_EMPLEADO');
  if (colId !== -1 && limpiarId_(hoja.getRange(cuenta._fila, colId + 1).getValue()) !== cuenta.ID_EMPLEADO) {
    const actual = cuentaDe_(cuenta.ID_EMPLEADO);
    if (!actual) throw new Error('No se encontró la cuenta ' + cuenta.ID_EMPLEADO + ' en ACCESOS. Avísale a RH.');
    cuenta._fila = actual._fila;
  }
  Object.keys(cambios).forEach(function (k) {
    cuenta[k] = cambios[k];
    const i = enc.indexOf(k);
    if (i === -1) return;
    const celda = hoja.getRange(cuenta._fila, i + 1);
    celda.setValue(textoAcceso_(cambios[k])); // protege textos que Sheets tomaría como fórmula (ej. PIN cifrado con "+")
    if (esFecha_(cambios[k])) { try { celda.setNumberFormat(FORMATO_FECHA_HORA); } catch (e) {} }
  });
  SpreadsheetApp.flush(); // que las otras páginas vean el cambio de inmediato
}

/** Registro de todo lo que pasa con las cuentas. Nunca debe impedir que alguien entre. */
function bitacora_(id, evento, detalle, usuario) {
  try {
    const hoja = hojaAccesos_(ACCESO.HOJA_BITACORA, ENC_BITACORA);
    hoja.appendRow([new Date(), id, evento, detalle || '', usuario || '']);
  } catch (e) {}
}

// ============================================================
// MENÚ DE RH (en la hoja de cálculo)
// ============================================================

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('LimpiaLeón RH')
      .addItem('Asignar PIN a un empleado', 'rhAsignarPin')
      .addItem('Desbloquear cuenta', 'rhDesbloquear')
      .addItem('Reactivar cuenta (que cree su PIN otra vez)', 'rhReactivar')
      .addItem('Cerrar sesiones abiertas', 'rhCerrarSesiones')
      .addSeparator()
      .addItem('Ver estado de una cuenta', 'rhVerCuenta')
      .addSeparator()
      .addItem('Generar PDF de expedientes que faltan', 'rhGenerarPdfsExpedientes') // >>> CAMBIO
      .addToUi();
  } catch (e) {}
}

function rhAsignarPin() {
  const ui = SpreadsheetApp.getUi();
  const e = pedirEmpleado_(ui, 'Asignar PIN');
  if (!e) return;
  const r = ui.prompt('Asignar PIN · ' + e.nombre, 'Escribe el PIN de 4 números que le vas a dar.\n' +
    'Su PIN anterior dejará de funcionar.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const pin = r.getResponseText().trim();
  if (!/^\d{4}$/.test(pin)) { ui.alert('El PIN deben ser 4 números.'); return; }
  const problema = problemaPin_(pin, e.emp);
  if (problema && ui.alert('PIN fácil de adivinar', problema + '\n\n¿Usarlo de todas formas?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const usuario = usuarioActual_();
  conCandado_(function () {
    const cuenta = cuentaDe_(e.id) || crearCuenta_(e.id, e.emp);
    const ahora = new Date();
    const sal = Utilities.getUuid();
    guardarCuenta_(cuenta, {
      NOMBRE: nombreCompleto_(e.emp),
      ESTADO: EST_ACCESO.ACTIVO,
      ORIGEN_PIN: 'ASIGNADO POR RH',
      ASIGNADO_POR: usuario,
      FECHA_ACTIVACION: aFecha_(cuenta.FECHA_ACTIVACION) || ahora,
      FECHA_CAMBIO_PIN: ahora,
      INTENTOS_PIN: 0,
      INTENTOS_DOC: 0,
      ESPERA_HASTA: '',
      SESIONES_DESDE: ahora,
      PIN_HASH: hashPin_(pin, sal),
      SAL: sal
    });
    revocarSesiones_(e.id);
    bitacora_(e.id, 'PIN_ASIGNADO_RH', '', usuario);
  });
  ui.alert('Listo', e.nombre + ' ya puede entrar con su número de prestador de servicio ' + e.id + ' y el PIN ' + pin + '.', ui.ButtonSet.OK);
}

function rhDesbloquear() {
  const ui = SpreadsheetApp.getUi();
  const e = pedirEmpleado_(ui, 'Desbloquear cuenta');
  if (!e) return;
  const usuario = usuarioActual_();
  const msg = conCandado_(function () {
    const cuenta = cuentaDe_(e.id);
    if (!cuenta) return e.nombre + ' todavía no ha activado su cuenta; no hay nada que desbloquear.';
    const hash = String(cuenta.PIN_HASH || '').trim();
    const danado = hash.charAt(0) === '#'; // PIN dañado (#ERROR!…): cuenta como "sin PIN"
    const conPin = !!(hash && !danado && String(cuenta.SAL || '').trim());
    guardarCuenta_(cuenta, { ESTADO: conPin ? EST_ACCESO.ACTIVO : EST_ACCESO.SIN_ACTIVAR, INTENTOS_PIN: 0, INTENTOS_DOC: 0, ESPERA_HASTA: '' });
    bitacora_(e.id, 'DESBLOQUEO_RH', '', usuario);
    return 'Listo. ' + e.nombre + (conPin ? ' ya puede entrar con su PIN.'
      : danado ? ' tenía el PIN dañado: tiene que crear uno nuevo en la página "Crea tu PIN".'
      : ' ya puede activar su cuenta.');
  });
  ui.alert(msg);
}

function rhReactivar() {
  const ui = SpreadsheetApp.getUi();
  const e = pedirEmpleado_(ui, 'Reactivar cuenta');
  if (!e) return;
  if (ui.alert('Reactivar cuenta', 'Se borrará el PIN de ' + e.nombre + '. La próxima vez que entre, confirmará su ' +
    'documento y creará uno nuevo.\n\n¿Continuar?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const usuario = usuarioActual_();
  conCandado_(function () {
    const cuenta = cuentaDe_(e.id) || crearCuenta_(e.id, e.emp);
    guardarCuenta_(cuenta, { ESTADO: EST_ACCESO.SIN_ACTIVAR, ORIGEN_PIN: '', ASIGNADO_POR: '', INTENTOS_PIN: 0,
      INTENTOS_DOC: 0, ESPERA_HASTA: '', SESIONES_DESDE: new Date(), PIN_HASH: '', SAL: '' });
    revocarSesiones_(e.id);
    bitacora_(e.id, 'REACTIVACION_RH', '', usuario);
  });
  ui.alert('Listo. ' + e.nombre + ' creará su PIN nuevo la próxima vez que entre.');
}

function rhCerrarSesiones() {
  const ui = SpreadsheetApp.getUi();
  const e = pedirEmpleado_(ui, 'Cerrar sesiones abiertas');
  if (!e) return;
  const usuario = usuarioActual_();
  conCandado_(function () {
    const cuenta = cuentaDe_(e.id);
    if (cuenta) guardarCuenta_(cuenta, { SESIONES_DESDE: new Date() });
    revocarSesiones_(e.id);
    bitacora_(e.id, 'SESIONES_CERRADAS_RH', '', usuario);
  });
  ui.alert('Listo. Se cerraron las sesiones abiertas de ' + e.nombre + '. Tendrá que volver a escribir su PIN.');
}

function rhVerCuenta() {
  const ui = SpreadsheetApp.getUi();
  const e = pedirEmpleado_(ui, 'Ver estado de una cuenta');
  if (!e) return;
  const cuenta = cuentaDe_(e.id);
  const tz = libro_().getSpreadsheetTimeZone();
  const f = function (v) { const d = aFecha_(v); return d ? Utilities.formatDate(d, tz, 'dd/MM/yyyy HH:mm') : '—'; };
  const docs = documentosDe_(e.emp).map(function (d) { return d.nombre.replace(/^tu /, ''); });
  let estado = cuenta ? estadoAcceso_(cuenta) : EST_ACCESO.SIN_ACTIVAR;
  const bloqueo = bloqueoDe_(cuenta);
  if (bloqueo && bloqueo.acceso === 'ESPERA') {
    const m = bloqueo.minutos;
    estado += ' (esperando ' + (m < 60 ? m + ' min' : Math.ceil(m / 60) + (Math.ceil(m / 60) === 1 ? ' hora' : ' horas')) + ' por intentos equivocados)';
  }
  ui.alert(e.nombre + ' · ' + e.id, [
    'Estado: ' + estado,
    'PIN: ' + (cuenta && String(cuenta.PIN_HASH || '').trim().charAt(0) === '#' ? 'DAÑADO (tiene que crear uno nuevo en "Crea tu PIN")'
      : cuenta && cuenta.ORIGEN_PIN ? String(cuenta.ORIGEN_PIN).toLowerCase() + (cuenta.ASIGNADO_POR ? ' (' + cuenta.ASIGNADO_POR + ')' : '') : 'sin PIN'),
    'Activó su cuenta: ' + (cuenta ? f(cuenta.FECHA_ACTIVACION) : '—'),
    'Último acceso: ' + (cuenta ? f(cuenta.ULTIMO_ACCESO) : '—'),
    'Intentos equivocados: PIN ' + (cuenta ? erroresVigentes_(cuenta, 'INTENTOS_PIN') : 0) + ' · documento ' + (cuenta ? erroresVigentes_(cuenta, 'INTENTOS_DOC') : 0),
    'Documentos para activar: ' + (docs.length ? docs.join(', ') : 'NINGUNO (asígnale un PIN)')
  ].join('\n'), ui.ButtonSet.OK);
}

function pedirEmpleado_(ui, titulo) {
  const r = ui.prompt(titulo, 'Número de prestador de servicio:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  const id = limpiarId_(r.getResponseText());
  const emp = id ? obtenerEmpleadoMaestro_(id) : null;
  if (!emp) { ui.alert('No se encontró el número de prestador de servicio "' + id + '".'); return null; }
  return { id: id, emp: emp, nombre: nombreCompleto_(emp) || id };
}

function usuarioActual_() {
  try { return Session.getActiveUser().getEmail() || 'RH'; } catch (e) { return 'RH'; }
}

/**
 * Correr UNA vez desde el editor. Prepara la base de accesos:
 *  - Si pegaste un ID en CONFIG.ACCESOS_ID, usa ese archivo.
 *  - Si lo dejaste vacío, crea el archivo "LimpiaLeón · ACCESOS (NO COMPARTIR)" en tu Drive.
 * Crea las pestañas ACCESOS y BITACORA y la clave secreta de cifrado. Se puede correr varias veces.
 */
function configurarAccesos() {
  if (!Session.getActiveUser().getEmail()) throw new Error('Ejecuta esta función desde el editor de Apps Script.');
  const props = PropertiesService.getScriptProperties();
  if (!String(CONFIG.ACCESOS_ID || '').trim() && !props.getProperty('ACCESOS_ID')) {
    const nuevo = SpreadsheetApp.create('LimpiaLeón · ACCESOS (NO COMPARTIR)');
    props.setProperty('ACCESOS_ID', nuevo.getId());
    Logger.log('Se creó el archivo de accesos: ' + nuevo.getUrl());
  }
  hojaAccesos_(ACCESO.HOJA_ACCESOS, ENC_ACCESOS);
  hojaAccesos_(ACCESO.HOJA_BITACORA, ENC_BITACORA);
  const ss = libroAccesos_();
  ss.getSheets().forEach(function (h) {
    if ([ACCESO.HOJA_ACCESOS, ACCESO.HOJA_BITACORA].indexOf(h.getName()) === -1 && h.getLastRow() === 0 && ss.getSheets().length > 2) ss.deleteSheet(h);
  });
  pimienta_(true);
  Logger.log('OK · Base de accesos lista: ' + ss.getUrl());
  // Cuántos empleados podrán activar su cuenta solos (tienen clave de elector, RFC o CURP válidos).
  const hoja = hoja_(CONFIG.HOJA_MAESTRA);
  const valores = hoja.getDataRange().getValues();
  let filaEnc = -1;
  for (let i = 0; i < Math.min(10, valores.length); i++) {
    if (valores[i].map(limpiarId_).indexOf('ID_EMPLEADO') !== -1) { filaEnc = i; break; }
  }
  if (filaEnc === -1) return;
  const enc = valores[filaEnc].map(limpiarId_);
  const colId = enc.indexOf('ID_EMPLEADO');
  const cuenta = { ELECTOR: 0, RFC: 0, CURP: 0 };
  const sinNada = [];
  let total = 0;
  for (let i = filaEnc + 1; i < valores.length; i++) {
    const id = limpiarId_(valores[i][colId]);
    if (!id) continue;
    total++;
    const docs = documentosDe_(aObjeto_(enc, valores[i], i + 1));
    docs.forEach(function (d) { cuenta[d.tipo]++; });
    if (!docs.length) sinNada.push(id);
  }
  Logger.log('Empleados: ' + total + ' · con clave de elector: ' + cuenta.ELECTOR + ' · con RFC: ' + cuenta.RFC +
    ' · con CURP: ' + cuenta.CURP);
  Logger.log(sinNada.length ? 'Sin ningún documento válido (RH debe asignarles PIN): ' + sinNada.join(', ')
    : 'Todos pueden activar su cuenta solos.');
}

// ============================================================
// AUTOMÁTICO EN LA HOJA
// ============================================================

/**
 * CONTROL EXP:
 * - Si RH modifica REVISOR manualmente, actualiza FECHA_REVISION.
 * - Si ESTADO cambia manualmente a COMPLETADO, limpia OBSERVACIONES y CORREGIR.
 * - No toca ninguna otra columna.
 */
function onEdit(e) {
  try {
    const rango = e && e.range;
    if (!rango) return;

    const hoja = rango.getSheet();

    if (
      hoja.getName().trim().toUpperCase() !== CONFIG.HOJA_EXPEDIENTES ||
      rango.getLastRow() < 2
    ) return;

    const enc = hoja
      .getRange(1, 1, 1, hoja.getLastColumn())
      .getValues()[0]
      .map(function (h) {
        return String(h).trim();
      });

    const colEstado = enc.indexOf('ESTADO') + 1;
    const colRevisor = enc.indexOf('REVISOR') + 1;
    const colFecha = enc.indexOf('FECHA_REVISION') + 1;
    const colCorregir = enc.indexOf('CORREGIR') + 1;
    const colObservaciones = enc.indexOf('OBSERVACIONES') + 1;

    if (
      !colEstado ||
      !colRevisor ||
      !colFecha ||
      !colCorregir ||
      !colObservaciones
    ) return;

    const afectaEstado =
      colEstado >= rango.getColumn() &&
      colEstado <= rango.getLastColumn();

    const afectaRevisor =
      colRevisor >= rango.getColumn() &&
      colRevisor <= rango.getLastColumn();

    if (!afectaEstado && !afectaRevisor) return;

    const inicio = Math.max(2, rango.getRow());
    const fin = rango.getLastRow();

    for (let fila = inicio; fila <= fin; fila++) {

      // Si ESTADO se cambia manualmente a COMPLETADO,
      // limpiar OBSERVACIONES y CORREGIR.
      if (afectaEstado) {
        const estado = String(
          hoja.getRange(fila, colEstado).getValue() || ''
        ).trim().toUpperCase();

        if (estado === 'COMPLETADO' || estado === 'COMPLETO') {
          hoja.getRange(fila, colObservaciones).clearContent();
          hoja.getRange(fila, colCorregir).clearContent();
        }
      }

      // Mantener funcionamiento actual de REVISOR -> FECHA_REVISION.
      if (afectaRevisor) {
        const revisor = String(
          hoja.getRange(fila, colRevisor).getValue() || ''
        ).trim();

        const celdaFecha = hoja.getRange(fila, colFecha);

        if (revisor) {
          celdaFecha
            .setValue(new Date())
            .setNumberFormat(FORMATO_FECHA_HORA);
        } else {
          celdaFecha.clearContent();
        }
      }
    }

    SpreadsheetApp.flush();

  } catch (err) {
    console.log('onEdit CONTROL EXP: ' + err);
  }
}

// ============================================================
// UTILIDADES PARA CORRER A MANO DESDE EL EDITOR
// ============================================================

/** Crea las pestañas con sus encabezados (se puede correr varias veces sin borrar nada). */
function configurarHojas() {
  verificarAccesoAdministrador_();
  const pestanas = [{ hoja: CONFIG.HOJA_EXPEDIENTES, columnas: ENC_EXPEDIENTES }].concat(SECCIONES);
  pestanas.forEach(function (p) {
    try {
      const h = obtenerHoja_(p.hoja, p.columnas);
      const enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); });
      // El orden de las columnas no importa (el sistema las busca por nombre); solo que estén todas.
      const faltan = p.columnas.filter(function (c) { return enc.indexOf(c) === -1; });
      Logger.log((faltan.length ? 'REVISAR ' : 'OK      ') + p.hoja + ' → ' + (faltan.length
        ? 'faltan columnas: ' + faltan.join(', ') : p.columnas.length + ' columnas completas'));
    } catch (e) {
      Logger.log('ERROR   ' + p.hoja + ' → ' + e.message);
    }
  });
}

/**
 * Diagnóstico: muestra en el registro todas las pestañas (con su nombre exacto entre comillas),
 * si están ocultas, cuántas filas tienen y en qué fila está cada folio.
 */
function diagnosticarPestanas() {
  libro_().getSheets().forEach(function (h) {
    const nombre = h.getName();
    let folios = '';
    if (h.getLastRow() >= 2 && h.getLastColumn() >= 1) {
      const t = leerTabla_(h);
      const col = t.encabezados.indexOf('FOLIO');
      if (col !== -1) {
        folios = t.filas.map(function (f, i) { return String(f[col]).trim() ? f[col] + ' (fila ' + (i + 2) + ')' : ''; })
          .filter(String).join(', ');
      }
    }
    Logger.log('"' + nombre + '"' + (h.isSheetHidden() ? ' [OCULTA]' : '') + ' · última fila con datos: ' + h.getLastRow() +
      ' · columnas: ' + h.getLastColumn() + (folios ? ' · folios: ' + folios : ''));
  });
}

/** Prueba rápida: muestra lo que recibiría el navegador de un empleado (cambia el número si quieres). */
function probarBusqueda() {
  Logger.log(JSON.stringify(iniciarAcceso('A0001'), null, 2));
  Logger.log(JSON.stringify(datosExpediente_('A0001'), null, 2));
}

// ============================================================
// HOJA MAESTRA (solo lectura)
// ============================================================
let libroCache_ = null;
function libro_() {
  if (!libroCache_) libroCache_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return libroCache_;
}

function obtenerEmpleadoMaestro_(id) {
  if (!id) return null;
  const hoja = hoja_(CONFIG.HOJA_MAESTRA);
  if (!hoja) throw new Error('No se encontró la pestaña "' + CONFIG.HOJA_MAESTRA + '".');
  // Busca la fila de encabezados en las primeras 10 filas (por si hay títulos arriba).
  const valores = hoja.getDataRange().getValues();
  let filaEnc = -1;
  for (let i = 0; i < Math.min(10, valores.length); i++) {
    if (valores[i].map(limpiarId_).indexOf('ID_EMPLEADO') !== -1) { filaEnc = i; break; }
  }
  if (filaEnc === -1) {
    throw new Error('La pestaña "' + CONFIG.HOJA_MAESTRA + '" no tiene la columna ID_EMPLEADO en sus primeras filas.');
  }
  const encabezados = valores[filaEnc].map(limpiarId_);
  const col = encabezados.indexOf('ID_EMPLEADO');
  for (let i = filaEnc + 1; i < valores.length; i++) {
    if (limpiarId_(valores[i][col]) === id) return aObjeto_(encabezados, valores[i], i + 1);
  }
  return null;
}

/** Valor tal como está en la BD, ya normalizado a las opciones de la lista. */
function valorOriginal_(emp, campo, tz) {
  let v = aTexto_(emp[campo], tz);
  if (campo === 'PUESTO' && aTexto_(emp.PUESTO_PLANTILLA, tz)) v = aTexto_(emp.PUESTO_PLANTILLA, tz); // columna J primero, luego H
  if ((CAMPOS_FECHA.indexOf(campo) !== -1 || campo === 'FECHA_INGRESO') && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v = textoAFechaISO_(v);
  return normalizarOpcion_(campo, v);
}

function datosParaCliente_(emp, tz) {
  const d = { ID_EMPLEADO: aTexto_(emp.ID_EMPLEADO, tz).toUpperCase() };
  CAMPOS_EDITABLES.forEach(function (c) {
    d[c] = CAMPOS_SIN_PRECARGA.indexOf(c) !== -1 ? '' : valorOriginal_(emp, c, tz);
  });
  const otro = separarOtro_(d.SERVICIO_MEDICO);
  if (otro) { d.SERVICIO_MEDICO = 'OTRO'; d.SERVICIO_MEDICO_OTRO = otro; }
  d.NUMERO_HIJOS = valorOriginal_(emp, 'NUMERO_HIJOS', tz);
  d.PERSONAS_DEPENDIENTES = valorOriginal_(emp, 'PERSONAS_DEPENDIENTES', tz);
  return d;
}

// ============================================================
// LIMPIEZA Y VALIDACIÓN DE LO QUE MANDA EL EMPLEADO
// ============================================================
function sanitizarDatos_(raw) {
  const d = {};
  CAMPOS_EDITABLES.forEach(function (c) {
    let v = limpiarTexto_(raw[c], 250);
    v = c === 'CORREO_PERSONAL' ? v.toLowerCase() : v.toUpperCase();
    if (c === 'TELEFONO' || c === 'TELEFONO_EMERGENCIA' || c === 'CODIGO_POSTAL') v = v.replace(/\D/g, '');
    if (c === 'RFC' || c === 'CURP') v = v.replace(/\s/g, '');
    d[c] = v;
  });
  const otroMunicipio = limpiarTexto_(raw.MUNICIPIO_OTRO, 100).toUpperCase();
  if (d.MUNICIPIO === 'OTRO' && otroMunicipio) d.MUNICIPIO = otroMunicipio;
  const otro = limpiarTexto_(raw.SERVICIO_MEDICO_OTRO, 100).toUpperCase();
  if (d.SERVICIO_MEDICO === 'OTRO' && otro) d.SERVICIO_MEDICO = 'OTRO: ' + otro;
  if (!d.SERVICIO_MEDICO || d.SERVICIO_MEDICO === 'NINGUNO') d.SERVICIO_MEDICO_VIGENTE = ''; // sin servicio no se pregunta
  if (d.MANEJA !== 'SÍ') { d.TIPO_LICENCIA = ''; d.ESTATUS_LICENCIA = ''; }
  if (d.TIPO_LICENCIA === 'NO TIENE') d.ESTATUS_LICENCIA = '';
  return d;
}

function validarDatos_(d) {
  const e = [];
  CAMPOS_OBLIGATORIOS.forEach(function (c) { if (!d[c]) e.push(ETIQUETAS[c] || c); });
  if (d.SERVICIO_MEDICO === 'OTRO') e.push('Especifica tu servicio médico');
  if (d.SERVICIO_MEDICO && d.SERVICIO_MEDICO !== 'NINGUNO' && !d.SERVICIO_MEDICO_VIGENTE) e.push('Vigencia del servicio médico');
  if (d.MUNICIPIO === 'OTRO') e.push('Escribe tu municipio');
  if (d.MANEJA === 'SÍ' && !d.TIPO_LICENCIA) e.push('Tipo de licencia');
  if (d.TIPO_LICENCIA && d.TIPO_LICENCIA !== 'NO TIENE' && !d.ESTATUS_LICENCIA) e.push('Vigencia de la licencia');
  if (d.TELEFONO && !/^\d{10}$/.test(d.TELEFONO)) e.push('Teléfono (10 dígitos)');
  if (d.TELEFONO_EMERGENCIA && !/^\d{10}$/.test(d.TELEFONO_EMERGENCIA)) e.push('Teléfono de emergencia (10 dígitos)');
  if (d.CODIGO_POSTAL && !/^\d{5}$/.test(d.CODIGO_POSTAL)) e.push('Código postal (5 dígitos)');
  if (d.CURP && !/^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d$/.test(d.CURP)) e.push('CURP (18 caracteres)');
  if (d.RFC && !/^[A-ZÑ&]{3,4}\d{6}([A-Z0-9]{3})?$/.test(d.RFC)) e.push('RFC');
  if (d.CORREO_PERSONAL && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.CORREO_PERSONAL)) e.push('Correo personal');
  CAMPOS_FECHA.forEach(function (c) { if (d[c] && !fechaISOValida_(d[c])) e.push(ETIQUETAS[c]); });
  if (e.length) throw new Error('Revisa estos datos: ' + e.filter(unico_).join(', ') + '.');
}

function sanitizarHijos_(lista) {
  if (!Array.isArray(lista)) return [];
  if (lista.length > CONFIG.MAX_HIJOS) throw new Error('Se pueden registrar máximo ' + CONFIG.MAX_HIJOS + ' hijos.');
  return lista.map(function (h, i) {
    h = h || {};
    const nombre = limpiarTexto_(h.nombre, 150).toUpperCase();
    const fecha = limpiarTexto_(h.fechaNacimiento, 10);
    if (!nombre) throw new Error('Falta el nombre del hijo ' + (i + 1) + '.');
    if (!fechaISOValida_(fecha)) throw new Error('Revisa la fecha de nacimiento del hijo ' + (i + 1) + '.');
    return { nombre: nombre, fecha: fecha, edad: calcularEdad_(fecha) };
  });
}

function sanitizarAdultos_(lista) {
  if (!Array.isArray(lista)) return [];
  if (lista.length > CONFIG.MAX_ADULTOS) throw new Error('Se pueden registrar máximo ' + CONFIG.MAX_ADULTOS + ' personas.');
  return lista.map(function (a, i) {
    a = a || {};
    const nombre = limpiarTexto_(a.nombre, 150).toUpperCase();
    const edad = parseInt(a.edad, 10);
    const parentesco = limpiarTexto_(a.parentesco, 50).toUpperCase();
    if (!nombre) throw new Error('Falta el nombre de la persona ' + (i + 1) + '.');
    if (!(edad >= 18 && edad <= 120)) throw new Error('La edad de la persona ' + (i + 1) + ' debe ser de 18 años o más.');
    if (!parentesco) throw new Error('Falta el parentesco de la persona ' + (i + 1) + '.');
    return { nombre: nombre, edad: edad, parentesco: parentesco };
  });
}

/** FAMILIARES: una fila por empleado; cada persona es un renglón dentro de la celda ("1) ANA PÉREZ"). */
function filaFamiliares_(hijos, adultos) {
  const renglones = function (lista, fn) {
    return lista.map(function (x, i) { return (i + 1) + ') ' + fn(x); }).join('\n');
  };
  return {
    NUMERO_HIJOS: hijos.length,
    NOMBRE_HIJOS: renglones(hijos, function (h) { return h.nombre; }),
    FECHA_NACIMIENTO_HIJOS: renglones(hijos, function (h) { return h.fecha.split('-').reverse().join('/'); }),
    EDAD_HIJOS: renglones(hijos, function (h) { return h.edad + (h.edad === 1 ? ' AÑO' : ' AÑOS'); }),
    PERSONAS_DEPENDIENTES: adultos.length,
    NOMBRE_ADULTOS: renglones(adultos, function (a) { return a.nombre; }),
    EDAD_ADULTOS: renglones(adultos, function (a) { return a.edad + ' AÑOS'; }),
    PARENTESCO_ADULTOS: renglones(adultos, function (a) { return a.parentesco; })
  };
}

/** Lee de vuelta las edades de "1) 11 AÑOS\n2) 26 AÑOS". */
function edadesDeCelda_(texto) {
  return String(texto || '').split('\n').filter(String).map(function (r) {
    const m = r.match(/^\s*\d+\)\s*(\d+)/);
    return m ? Number(m[1]) : -1;
  });
}

function validarMeta_(meta) {
  meta = meta || {};
  const tipo = String(meta.tipo || '');
  const familiar = String(meta.familiar || '');
  const lado = String(meta.lado || '');
  const ladoOk = lado === 'FRENTE' || lado === 'REVERSO';
  if (tipo === 'FOTO_PERFIL' && !familiar && !lado) return { tipo: tipo, familiar: '', lado: '' };
  if (tipo === 'COMPROBANTE' && !familiar && !lado) return { tipo: tipo, familiar: '', lado: '' }; // >>> CAMBIO
  if (tipo === 'LICENCIA' && !familiar && ladoOk) return { tipo: tipo, familiar: '', lado: lado };
  if (tipo === 'INE' && ladoOk && (familiar === '' || /^(HIJO|ADULTO) \d{1,2}$/.test(familiar))) {
    return { tipo: tipo, familiar: familiar, lado: lado };
  }
  throw new Error('Documento no válido.');
}

// ============================================================
// DOCUMENTOS EN DRIVE
// ============================================================

/** Lista de fotos que debe tener el envío, según lo que se guardó en las pestañas. */
function documentosRequeridos_(folio) {
  const control = filaPorFolio_(CONFIG.HOJA_EXPEDIENTES, folio) || {};
  const sinIne = String(control.INE_NO_ENTREGADA || '').split(',').map(function (x) { return x.trim(); });
  const r = [{ tipo: 'FOTO_PERFIL', familiar: '', lado: '', etiqueta: 'Foto de perfil' }];
  if (sinIne.indexOf('EMPLEADO') === -1) {
    r.push({ tipo: 'INE', familiar: '', lado: 'FRENTE', etiqueta: 'INE (frente)' });
    r.push({ tipo: 'INE', familiar: '', lado: 'REVERSO', etiqueta: 'INE (reverso)' });
  }
  const salud = filaPorFolio_(HOJA_SALUD, folio) || {};
  if (requiereLicencia_(salud)) {
    r.push({ tipo: 'LICENCIA', familiar: '', lado: 'FRENTE', etiqueta: 'Licencia (frente)' });
    r.push({ tipo: 'LICENCIA', familiar: '', lado: 'REVERSO', etiqueta: 'Licencia (reverso)' });
  }
  // >>> CAMBIO: comprobante de domicilio (no se pide si marcó "No la tengo a la mano")
  if (sinIne.indexOf('COMPROBANTE') === -1) {
    r.push({ tipo: 'COMPROBANTE', familiar: '', lado: '', etiqueta: 'Comprobante de domicilio' });
  }
  return r;
}

/** INE (o comprobante) que el empleado marcó "No la tengo a la mano": EMPLEADO, COMPROBANTE, HIJO 2, ADULTO 1… (solo las que aplican). */
function sinIne_(lista, hijos, adultos) {
  if (!Array.isArray(lista)) return [];
  const validas = ['EMPLEADO', 'COMPROBANTE']; // >>> CAMBIO: se agrega COMPROBANTE
  hijos.forEach(function (h, i) { if (h.edad >= 18) validas.push('HIJO ' + (i + 1)); });
  adultos.forEach(function (a, i) { validas.push('ADULTO ' + (i + 1)); });
  return lista.map(function (x) { return limpiarTexto_(x, 20).toUpperCase(); })
    .filter(function (x) { return validas.indexOf(x) !== -1; }).filter(unico_);
}

/**
 * >>> CAMBIO: respuestas "¿Está vigente?" de cada INE que sí se sube (solo para estadística; no bloquea el envío).
 * Regresa { empleado: 'SÍ' | 'NO' | '', familiares: 'HIJO 1: SÍ, ADULTO 1: NO' }.
 */
function ineVigente_(mapa, hijos, adultos, sinIne) {
  const r = { empleado: '', familiares: '' };
  if (!mapa || typeof mapa !== 'object') return r;
  const val = function (x) { const v = String(x || '').trim().toUpperCase(); return v === 'SI' || v === 'SÍ' ? 'SÍ' : (v === 'NO' ? 'NO' : ''); };
  if (sinIne.indexOf('EMPLEADO') === -1) r.empleado = val(mapa.EMPLEADO);
  const fam = [];
  hijos.forEach(function (h, i) { if (h.edad >= 18) fam.push('HIJO ' + (i + 1)); });
  adultos.forEach(function (a, i) { fam.push('ADULTO ' + (i + 1)); });
  r.familiares = fam.filter(function (f) { return sinIne.indexOf(f) === -1 && val(mapa[f]); })
    .map(function (f) { return f + ': ' + val(mapa[f]); }).join(', ');
  return r;
}

/** >>> CAMBIO: lee lo guardado en CONTROL EXP → { EMPLEADO: 'SÍ', 'HIJO 1': 'NO', … } (para precargar en un reenvío). */
function ineVigenteGuardada_(datos) {
  const r = {};
  const e = String(datos.INE_VIGENTE || '').trim().toUpperCase();
  if (e === 'SÍ' || e === 'SI') r.EMPLEADO = 'SÍ'; else if (e === 'NO') r.EMPLEADO = 'NO';
  String(datos.INE_VIGENTE_FAMILIARES || '').split(',').forEach(function (x) {
    const m = x.trim().toUpperCase().match(/^((?:HIJO|ADULTO) \d{1,2}):\s*(SÍ|SI|NO)$/);
    if (m) r[m[1]] = m[2] === 'NO' ? 'NO' : 'SÍ';
  });
  return r;
}

/**
 * >>> CAMBIO: respuestas sobre el comprobante de domicilio. Son OBLIGATORIAS aunque el empleado haya marcado
 * "No lo tengo a la mano" (el comprobante no es obligatorio, pero estas dos preguntas sí).
 * Regresa { coincide: 'SÍ' | 'NO', actual: 'SÍ' | 'NO' }; si falta alguna, no deja continuar el envío.
 */
function domicilioResp_(mapa) {
  const val = function (x) { const v = String(x || '').trim().toUpperCase(); return v === 'SI' || v === 'SÍ' ? 'SÍ' : (v === 'NO' ? 'NO' : ''); };
  mapa = (mapa && typeof mapa === 'object') ? mapa : {};
  const r = { coincide: val(mapa.coincide), actual: val(mapa.actual) };
  if (!r.coincide || !r.actual) throw new Error('Contesta las dos preguntas sobre tu comprobante de domicilio.');
  return r;
}

/** >>> CAMBIO: lo guardado en CONTROL EXP → 'SÍ' | 'NO' | '' */
function siNoGuardado_(v) {
  const x = String(v || '').trim().toUpperCase();
  return x === 'SÍ' || x === 'SI' ? 'SÍ' : (x === 'NO' ? 'NO' : '');
}

/** Se pide foto de la licencia si maneja, tiene licencia y no está en trámite. */
function requiereLicencia_(d) {
  return d.MANEJA === 'SÍ' && !!d.TIPO_LICENCIA && d.TIPO_LICENCIA !== 'NO TIENE' && d.ESTATUS_LICENCIA !== 'EN TRÁMITE';
}

/** ¿RH pidió volver a subir esta foto? */
function fotoMarcada_(m, corregir) {
  if (m.tipo === 'FOTO_PERFIL') return corregir.indexOf('FOTO_PERFIL') !== -1;
  if (m.tipo === 'LICENCIA') return corregir.indexOf('LICENCIA_FOTO') !== -1;
  if (m.tipo === 'COMPROBANTE') return corregir.indexOf('COMPROBANTE') !== -1; // >>> CAMBIO
  if (/^HIJO/.test(m.familiar)) return corregir.indexOf('INE_HIJOS') !== -1;
  if (/^ADULTO/.test(m.familiar)) return corregir.indexOf('INE_ADULTOS') !== -1;
  return corregir.indexOf('INE') !== -1;
}

/** "INE, Foto de perfil" → ['INE', 'FOTO_PERFIL'] */
function corregirDe_(valor) {
  return String(valor || '').replace(/salud\s*,\s*emergencia\s+y\s+uniforme/ig, 'SALUD Y EMERGENCIA') // este nombre lleva coma
    .split(/[,;\n]/).map(simplificar_)
    .map(function (s) { return CORREGIR[s]; }).filter(Boolean).filter(unico_);
}

// >>> CAMBIO: INE de familiares por lugar.
// Las fotos se guardan por lugar (HIJO 1, ADULTO 1…), no por persona. Si en un reenvío el nombre de ese lugar
// cambia, la INE que está en Drive es de la persona anterior y hay que subirla otra vez.
// Al iniciar un reenvío se apunta (en las propiedades del script) de quién es cada INE: los nombres que había en
// FAMILIARES antes de reemplazarlos. Se conserva en los reintentos ("En captura") y se borra al terminar el envío.
const CLAVE_INE_DUENOS = 'INE_DUENOS_'; // + folio

/** "  José  pérez " → "JOSE PEREZ" (mayúsculas, sin acentos, un solo espacio). */
function nombreFamiliar_(t) {
  return String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Fila de FAMILIARES → { 'HIJO 1': 'ANA PEREZ', 'ADULTO 1': 'LUIS RAMOS', … } */
function nombresFamiliares_(fam) {
  const r = {};
  renglonesDeCelda_(fam.NOMBRE_HIJOS).forEach(function (n, i) { r['HIJO ' + (i + 1)] = nombreFamiliar_(n); });
  renglonesDeCelda_(fam.NOMBRE_ADULTOS).forEach(function (n, i) { r['ADULTO ' + (i + 1)] = nombreFamiliar_(n); });
  return r;
}

/** Lo llama iniciarEnvio antes de reemplazar FAMILIARES. Expediente nuevo (sin fila en FAMILIARES): no se apunta nada. */
function guardarDuenosIne_(folio, est) {
  try {
    const props = PropertiesService.getScriptProperties();
    const clave = CLAVE_INE_DUENOS + folio;
    if (est === 'CAPTURA' && props.getProperty(clave)) return; // reintento: se quedan los dueños que ya se apuntaron
    const fam = filaPorFolio_('FAMILIARES', folio);
    if (fam) props.setProperty(clave, JSON.stringify(nombresFamiliares_(fam)));
    else if (props.getProperty(clave)) props.deleteProperty(clave);
  } catch (e) {
    console.error('guardarDuenosIne_: ' + e); // no se frena el envío por esto
  }
}

function borrarDuenosIne_(folio) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(CLAVE_INE_DUENOS + folio)) props.deleteProperty(CLAVE_INE_DUENOS + folio);
  } catch (e) {
    console.error('borrarDuenosIne_: ' + e);
  }
}

/** Lugares (HIJO 1, ADULTO 2…) donde la persona guardada ahora en FAMILIARES no es la dueña de la INE que está en Drive. */
function familiaresCambiados_(folio) {
  let duenos = null;
  try {
    const txt = PropertiesService.getScriptProperties().getProperty(CLAVE_INE_DUENOS + folio);
    duenos = txt ? JSON.parse(txt) : null;
  } catch (e) {
    duenos = null;
  }
  if (!duenos) return [];
  const actuales = nombresFamiliares_(filaPorFolio_('FAMILIARES', folio) || {});
  return Object.keys(actuales).filter(function (lugar) { return duenos[lugar] !== actuales[lugar]; });
}

function existeArchivo_(carpetaEmp, id, m, desde) {
  const it = carpetaEmp.getFoldersByName(nombreSubcarpeta_(m));
  if (!it.hasNext()) return false;
  const base = nombreArchivo_(id, m) + '.';
  const archivos = it.next().getFiles();
  while (archivos.hasNext()) {
    const f = archivos.next();
    if (!f.isTrashed() && f.getName().indexOf(base) === 0 && (!desde || f.getDateCreated() >= desde)) return true;
  }
  return false;
}

function nombreArchivo_(id, m) {
  return [id, m.familiar.replace(' ', ''), m.tipo, m.lado].filter(String).join('_');
}

function nombreSubcarpeta_(m) {
  if (m.tipo === 'FOTO_PERFIL') return 'FOTO DE PERFIL';
  if (m.tipo === 'LICENCIA') return 'LICENCIA';
  if (m.tipo === 'COMPROBANTE') return 'COMPROBANTE DOMICILIO'; // >>> CAMBIO
  return m.familiar ? 'INE ' + m.familiar : 'INE EMPLEADO';
}

function carpetaEmpleado_(dependencia, id) {
  const raiz = DriveApp.getFolderById(CONFIG.CARPETA_RAIZ_ID);
  return obtenerOCrearCarpeta_(obtenerOCrearCarpeta_(raiz, dependencia), id);
}

function obtenerOCrearCarpeta_(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

// ============================================================
// PESTAÑAS DE ENVÍOS
// ============================================================
function folio_(id) { return 'EXP-' + id; }

/** EXP-SEP-26: mes y año en que se envió. */
function campana_(fecha, tz) {
  const meses = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const mes = Number(Utilities.formatDate(fecha, tz, 'M'));
  return 'EXP-' + meses[mes - 1] + '-' + Utilities.formatDate(fecha, tz, 'yy');
}

/** Lee el ESTADO sin importar mayúsculas, acentos o espacios. */
function estadoDe_(valor) {
  const s = simplificar_(valor == null ? '' : valor);
  if (s === 'ENCAPTURA') return 'CAPTURA';
  if (s === 'PENDIENTE' || s === 'ENREVISION') return 'PENDIENTE';
  if (s === 'COMPLETO' || s === 'COMPLETADO' || s === 'APROBADO') return 'COMPLETO';
  if (s === 'INCOMPLETO' || s === 'CONOBSERVACIONES') return 'INCOMPLETO';
  // >>> CAMBIO: un ESTADO escrito a mano que no se reconoce ("APROBADA", "VALIDADO"…) cierra el expediente
  // como si estuviera en revisión: el empleado ya no puede volver a enviar y sobrescribir lo que RH revisó.
  // Solo vacío (o puros espacios) se toma como expediente nuevo, igual que antes.
  if (s) return 'PENDIENTE';
  return '';
}

/** Lo que el empleado envió la vez pasada (para corregir un expediente Incompleto). */
function envioPrevio_(folio, emp, tz) {
  const datos = {};
  SECCIONES.forEach(function (s) {
    const fila = filaPorFolio_(s.hoja, folio);
    if (!fila) return;
    CAMPOS_EDITABLES.forEach(function (c) {
      if (!Object.prototype.hasOwnProperty.call(fila, c) || CAMPOS_FIJOS.indexOf(c) !== -1) return;
      let v = aTexto_(fila[c], tz).replace(/^'/, '');
      if (CAMPOS_FECHA.indexOf(c) !== -1 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) v = textoAFechaISO_(v); // fecha guardada como texto
      if (c === 'TELEFONO' || c === 'TELEFONO_EMERGENCIA' || c === 'CODIGO_POSTAL') v = v.replace(/\.0+$/, '');
      datos[c] = v;
    });
  });
  const otro = separarOtro_(datos.SERVICIO_MEDICO);
  if (otro) { datos.SERVICIO_MEDICO = 'OTRO'; datos.SERVICIO_MEDICO_OTRO = otro; }

  const fam = filaPorFolio_('FAMILIARES', folio) || {};
  const nombresH = renglonesDeCelda_(fam.NOMBRE_HIJOS);
  const fechasH = renglonesDeCelda_(fam.FECHA_NACIMIENTO_HIJOS);
  const hijos = nombresH.map(function (n, i) {
    const f = String(fechasH[i] || '').split('/');
    return { nombre: n, fechaNacimiento: f.length === 3 ? f[2] + '-' + f[1] + '-' + f[0] : '' };
  });
  const nombresA = renglonesDeCelda_(fam.NOMBRE_ADULTOS);
  const edadesA = renglonesDeCelda_(fam.EDAD_ADULTOS);
  const parentescos = renglonesDeCelda_(fam.PARENTESCO_ADULTOS);
  const adultos = nombresA.map(function (n, i) {
    return { nombre: n, edad: String(parseInt(edadesA[i], 10) || ''), parentesco: parentescos[i] || '' };
  });
  return { datos: datos, hijos: hijos, adultos: adultos };
}

/** "1) ANA\n2) LUIS" → ["ANA", "LUIS"] */
function renglonesDeCelda_(texto) {
  return String(texto || '').split('\n').filter(function (r) { return r.trim(); })
    .map(function (r) { return r.replace(/^\s*\d+\)\s*/, '').trim(); });
}

/** Qué fotos ya están en Drive, con los nombres que usa la página (FOTO_PERFIL, INE_EMPLEADO_FRENTE, COMPROBANTE, HIJO_2_FRENTE…). */
function fotosExistentes_(dependencia, id) {
  const raiz = DriveApp.getFolderById(CONFIG.CARPETA_RAIZ_ID);
  const itDep = raiz.getFoldersByName(dependencia);
  if (!itDep.hasNext()) return [];
  const itEmp = itDep.next().getFoldersByName(id);
  if (!itEmp.hasNext()) return [];
  const encontradas = [];
  const subs = itEmp.next().getFolders();
  while (subs.hasNext()) {
    const archivos = subs.next().getFiles();
    while (archivos.hasNext()) {
      const f = archivos.next();
      if (f.isTrashed()) continue;
      const base = f.getName().replace(/\.[^.]+$/, '');
      if (base.indexOf(id + '_') !== 0) continue;
      const resto = base.slice(id.length + 1); // FOTO_PERFIL · COMPROBANTE · INE_FRENTE · LICENCIA_REVERSO · HIJO2_INE_FRENTE
      let clave = '';
      let m;
      if (resto === 'FOTO_PERFIL') clave = 'FOTO_PERFIL';
      else if (resto === 'COMPROBANTE') clave = 'COMPROBANTE'; // >>> CAMBIO
      else if ((m = resto.match(/^INE_(FRENTE|REVERSO)$/))) clave = 'INE_EMPLEADO_' + m[1];
      else if ((m = resto.match(/^LICENCIA_(FRENTE|REVERSO)$/))) clave = 'LICENCIA_' + m[1];
      else if ((m = resto.match(/^(HIJO|ADULTO)(\d+)_INE_(FRENTE|REVERSO)$/))) clave = m[1] + '_' + m[2] + '_' + m[3];
      if (clave && encontradas.indexOf(clave) === -1) encontradas.push(clave);
    }
  }
  return encontradas;
}

function envioDe_(id) {
  const hoja = hoja_(CONFIG.HOJA_EXPEDIENTES);
  if (!hoja || hoja.getLastRow() < 2) return null;
  const datos = filaPorFolio_(CONFIG.HOJA_EXPEDIENTES, folio_(id));
  return datos ? { hoja: hoja, datos: datos } : null;
}

/** El envío existe, es de este empleado y sigue "En captura". */
function envioAbierto_(folio, id) {
  const envio = id && String(folio) === folio_(id) ? envioDe_(id) : null;
  if (!envio || estadoDe_(envio.datos.ESTADO) !== 'CAPTURA') {
    throw new Error('El envío no es válido o ya fue cerrado. Vuelve a intentarlo.');
  }
  return envio;
}

/** Busca una pestaña por nombre sin importar mayúsculas ni espacios de más. */
function hoja_(nombre) {
  const ss = libro_();
  const exacta = ss.getSheetByName(nombre);
  if (exacta) return exacta;
  const buscado = String(nombre).trim().toUpperCase();
  const hallada = ss.getSheets().filter(function (h) { return h.getName().trim().toUpperCase() === buscado; })[0];
  if (hallada) return hallada;
  // La pestaña de control antes se llamaba "EXPEDIENTES": si existe, se renombra para no perder nada.
  if (nombre === CONFIG.HOJA_EXPEDIENTES) {
    const vieja = ss.getSheets().filter(function (h) { return h.getName().trim().toUpperCase() === 'EXPEDIENTES'; })[0];
    if (vieja) { vieja.setName(CONFIG.HOJA_EXPEDIENTES); return vieja; }
  }
  // Pestañas que cambiaron de nombre: si existe con el nombre anterior, se renombra para no perder nada.
  if (NOMBRES_ANTERIORES[nombre]) {
    const anterior = NOMBRES_ANTERIORES[nombre].toUpperCase();
    const vieja = ss.getSheets().filter(function (h) { return h.getName().trim().toUpperCase() === anterior; })[0];
    if (vieja) { vieja.setName(nombre); return vieja; }
  }
  return null;
}

function obtenerHoja_(nombre, encabezados) {
  const ss = libro_();
  let hoja = hoja_(nombre);
  if (!hoja) hoja = ss.insertSheet(nombre);
  // Si todavía no tiene envíos (solo encabezados o vacía), se escriben los encabezados exactos desde A1.
  if (hoja.getLastRow() <= 1) {
    const ancho = Math.max(hoja.getLastColumn(), encabezados.length);
    const fila = encabezados.concat(new Array(ancho - encabezados.length).fill(''));
    hoja.getRange(1, 1, 1, ancho).setValues([fila]);
    hoja.getRange(1, 1, 1, encabezados.length).setFontWeight('bold');
    hoja.setFrozenRows(1);
    return hoja;
  }
  // Si ya tiene envíos, no se borra nada: cada encabezado que falte se inserta como columna nueva
  // justo después de la columna que le toca (p. ej. SERVICIO_MEDICO_VIGENTE después de SERVICIO_MEDICO).
  const leer = function () {
    const n = hoja.getLastColumn();
    return n ? hoja.getRange(1, 1, 1, n).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  };
  let actuales = leer();
  let cambio = false;
  encabezados.forEach(function (e, i) {
    if (actuales.indexOf(e) !== -1) return;
    cambio = true;
    let despuesDe = 0; // columna (1, 2, 3…) después de la cual va
    for (let j = i - 1; j >= 0; j--) {
      const pos = actuales.indexOf(encabezados[j]);
      if (pos !== -1) { despuesDe = pos + 1; break; }
    }
    let col;
    try {
      // >>> CAMBIO: las columnas nuevas de CONTROL EXP siempre se agregan AL FINAL (nunca se inserta en medio).
      if (COLUMNAS_AL_FINAL.indexOf(e) !== -1) throw new Error('al final');
      if (!despuesDe || despuesDe >= actuales.length) throw new Error('al final');
      hoja.insertColumnAfter(despuesDe);
      col = despuesDe + 1;
    } catch (err) {
      col = actuales.length + 1; // si no se puede insertar (o va al final), se agrega al final
      // >>> CAMBIO: si la hoja ya no tiene columnas vacías a la derecha, se agrega UNA al final (no mueve nada).
      if (col > hoja.getMaxColumns()) hoja.insertColumnAfter(hoja.getMaxColumns());
    }
    hoja.getRange(1, col).setValue(e).setFontWeight('bold').setBackground('#f3f3f3');
    actuales = leer();
  });
  if (cambio) hoja.setFrozenRows(1);
  return hoja;
}

function leerTabla_(hoja) {
  const valores = hoja.getDataRange().getValues();
  return {
    encabezados: (valores[0] || []).map(function (h) { return String(h).trim(); }),
    filas: valores.slice(1)
  };
}

function aObjeto_(encabezados, fila, numFila) {
  const o = { _fila: numFila };
  encabezados.forEach(function (h, i) { if (h) o[h] = fila[i]; });
  return o;
}

function filaPorFolio_(nombreHoja, folio) {
  const hoja = hoja_(nombreHoja);
  if (!hoja || hoja.getLastRow() < 2) return null;
  const t = leerTabla_(hoja);
  const col = t.encabezados.indexOf('FOLIO');
  if (col === -1) return null;
  for (let i = 0; i < t.filas.length; i++) {
    if (String(t.filas[i][col]).trim() === String(folio)) return aObjeto_(t.encabezados, t.filas[i], i + 2);
  }
  return null;
}

/**
 * Guarda una fila buscándola por FOLIO. Si no existe, la agrega al final.
 * completa = true  → reemplaza toda la fila (lo que no venga queda vacío).
 * completa = false → solo cambia las columnas que vienen en obj.
 */
// Columnas que se guardan como texto para no perder ceros a la izquierda (CP 01234).
const COLUMNAS_TEXTO = ['CODIGO_POSTAL'];

function guardarFila_(hoja, obj, completa) {
  try {
    escribirFila_(hoja, obj, completa, false);
    SpreadsheetApp.flush(); // Sheets avisa del error al aplicar los cambios, no al escribir: se fuerza aquí
  } catch (e) {
    // Pestaña convertida en Tabla con alguna columna tipo "Texto" (o de otro tipo) que no acepta el dato
    // (fecha, teléfono, edad…): se guarda celda por celda y, si una la rechaza, se guarda como texto.
    if (!/formato|format|tipo|type|column/i.test(String(e && e.message))) throw e;
    escribirCeldaPorCelda_(hoja, obj, completa);
  }
}

function escribirCeldaPorCelda_(hoja, obj, completa) {
  const tz = libro_().getSpreadsheetTimeZone();
  obj = Object.assign({}, obj);
  Object.keys(obj).forEach(function (h) {
    if (esFecha_(obj[h])) obj[h] = Utilities.formatDate(obj[h], tz, FORMATO_FECHA[h] ? 'dd/MM/yyyy' : 'dd/MM/yyyy HH:mm');
  });
  COLUMNAS_TEXTO.forEach(function (c) { if (obj[c]) obj[c] = "'" + String(obj[c]).replace(/^'/, ''); });
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  const existente = filaPorFolio_(hoja.getName(), obj.FOLIO);
  const tiene = function (h) { return Object.prototype.hasOwnProperty.call(obj, h); };
  const numFila = existente ? existente._fila : hoja.getLastRow() + 1;
  const problemas = [];
  // El FOLIO va primero para que la fila se pueda encontrar aunque otra celda falle.
  const orden = enc.map(function (h, i) { return i; }).sort(function (a, b) { return (enc[a] === 'FOLIO' ? 0 : 1) - (enc[b] === 'FOLIO' ? 0 : 1); });
  orden.forEach(function (i) {
    const h = enc[i];
    if (!h || (!tiene(h) && !(completa || !existente))) return;
    const v = tiene(h) ? seguro_(obj[h]) : '';
    const celda = hoja.getRange(numFila, i + 1);
    try { celda.setValue(v); SpreadsheetApp.flush(); } catch (e1) {
      try { celda.setValue(v === '' ? '' : "'" + String(v).replace(/^'/, '')); SpreadsheetApp.flush(); } catch (e2) { problemas.push(h); return; }
    }
    try { if (typeof v === 'string' && v.indexOf('\n') !== -1) celda.setWrap(true); } catch (e3) {}
  });
  if (problemas.length) {
    throw new Error('La pestaña "' + hoja.getName() + '" no acepta el dato en la columna ' + problemas.join(', ') +
      '. Avísale a RH para que revise el tipo de esa columna.');
  }
}

function escribirFila_(hoja, obj, completa, fechasComoTexto) {
  obj = Object.assign({}, obj);
  if (fechasComoTexto) {
    const tz = libro_().getSpreadsheetTimeZone();
    Object.keys(obj).forEach(function (h) {
      if (esFecha_(obj[h])) obj[h] = Utilities.formatDate(obj[h], tz, FORMATO_FECHA[h] ? 'dd/MM/yyyy' : 'dd/MM/yyyy HH:mm');
    });
  }
  COLUMNAS_TEXTO.forEach(function (c) { if (obj[c]) obj[c] = "'" + String(obj[c]).replace(/^'/, ''); });
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  const existente = filaPorFolio_(hoja.getName(), obj.FOLIO);
  const tiene = function (h) { return Object.prototype.hasOwnProperty.call(obj, h); };
  let numFila;
  if (!existente) {
    hoja.appendRow(enc.map(function (h) { return tiene(h) ? seguro_(obj[h]) : ''; }));
    numFila = hoja.getLastRow();
  } else if (completa) {
    hoja.getRange(existente._fila, 1, 1, enc.length)
      .setValues([enc.map(function (h) { return tiene(h) ? seguro_(obj[h]) : ''; })]);
  } else {
    enc.forEach(function (h, i) { if (tiene(h)) hoja.getRange(existente._fila, i + 1).setValue(seguro_(obj[h])); });
  }
  numFila = numFila || existente._fila;
  // Fechas sin hora (dd/mm/aaaa) y celdas con varios renglones visibles.
  enc.forEach(function (h, i) {
    if (!tiene(h)) return;
    const v = obj[h];
    // Si la pestaña es una Tabla con la columna como "Texto", Sheets no deja cambiar el formato:
    // el dato ya se guardó, así que solo se omite el formato para no detener el envío.
    try {
      if (esFecha_(v)) hoja.getRange(numFila, i + 1).setNumberFormat(FORMATO_FECHA[h] || FORMATO_FECHA_HORA);
      else if (typeof v === 'string' && v.indexOf('\n') !== -1) hoja.getRange(numFila, i + 1).setWrap(true);
    } catch (e) {}
  });
}

// ============================================================
// AYUDANTES GENERALES
// ============================================================
function op_() {
  return Array.prototype.slice.call(arguments).map(function (p) { return { v: p[0], t: p[1] || p[0] }; });
}

function limpiarId_(v) {
  return String(v == null ? '' : v).trim().toUpperCase();
}

/** Número de prestador válido: 1 letra (L, A, F o X) + 4 números. Ej. A0001 */
function formatoIdValido_(id) {
  return /^[LAFX]\d{4}$/.test(String(id || ''));
}

function limpiarTexto_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 250);
}

function simplificar_(t) {
  return String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9+\-]/g, '');
}

function normalizarOpcion_(campo, valor) {
  const texto = String(valor == null ? '' : valor).trim();
  const opciones = OPCIONES[campo];
  if (!opciones || !texto) return texto;
  let clave = simplificar_(texto);
  const alias = ALIAS[campo] && ALIAS[campo][clave];
  if (alias) clave = simplificar_(alias);
  let hallada = opciones.filter(function (o) { return simplificar_(o.v) === clave; })[0];
  if (!hallada && /A$/.test(clave)) { // CASADA → CASADO
    const masculino = clave.slice(0, -1) + 'O';
    hallada = opciones.filter(function (o) { return simplificar_(o.v) === masculino; })[0];
  }
  return hallada ? hallada.v : texto.toUpperCase();
}

function separarOtro_(valor) {
  const m = String(valor || '').match(/^OTRO\s*[:\-]\s*(.+)$/i);
  return m ? m[1].trim() : '';
}

/** Fecha real, o texto "dd/mm/aaaa" / "dd/mm/aaaa hh:mm" (cuando la columna de la Tabla es tipo Texto). */
function aFecha_(v) {
  if (esFecha_(v)) return v;
  const m = String(v || '').replace(/^'/, '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const f = new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0);
  return isNaN(f.getTime()) ? null : f;
}

function esFecha_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function aTexto_(valor, tz) {
  if (valor === null || valor === undefined) return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return isNaN(valor.getTime()) ? '' : Utilities.formatDate(valor, tz, 'yyyy-MM-dd');
  }
  return String(valor).trim();
}

function textoAFechaISO_(t) {
  const m = String(t).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const iso = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return fechaISOValida_(iso) ? iso : '';
}

function fechaISOValida_(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const f = new Date(+m[1], +m[2] - 1, +m[3]);
  const existe = f.getFullYear() === +m[1] && f.getMonth() === +m[2] - 1 && f.getDate() === +m[3];
  return existe && +m[1] >= 1900 && f <= new Date();
}

function isoAFecha_(iso) {
  const m = String(iso).split('-');
  return new Date(+m[0], +m[1] - 1, +m[2], 12); // mediodía: evita que la zona horaria la mueva de día
}

function calcularEdad_(iso) {
  if (!fechaISOValida_(iso)) return '';
  const n = String(iso).split('-').map(Number);
  const hoy = new Date();
  let edad = hoy.getFullYear() - n[0];
  if (hoy.getMonth() + 1 < n[1] || (hoy.getMonth() + 1 === n[1] && hoy.getDate() < n[2])) edad--;
  return edad;
}

/** Evita que un texto que empieza con = + - @ se interprete como fórmula en Sheets. */
function seguro_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

function unico_(v, i, arr) { return arr.indexOf(v) === i; }

// ============================================================
// PDF AUTOMÁTICO cuando RH sube documentos desde el Panel RH
// ============================================================

/** Cada 5 minutos: hace el PDF nuevo de los expedientes donde RH subió un documento (DOCS_RH con datos y PDF_EXPEDIENTE vacío). */
function pdfsPendientesAutomatico() {
  const cache = CacheService.getScriptCache();
  if (cache.get('pdf_auto_en_curso')) return; // ya hay una corrida en marcha
  cache.put('pdf_auto_en_curso', '1', 300);
  try {
    const inicio = Date.now();
    const hoja = obtenerHoja_(CONFIG.HOJA_EXPEDIENTES, ENC_EXPEDIENTES);
    const t = leerTabla_(hoja);
    const cId = t.encabezados.indexOf('ID_EMPLEADO'), cEst = t.encabezados.indexOf('ESTADO');
    const cPdf = t.encabezados.indexOf('PDF_EXPEDIENTE'), cRh = t.encabezados.indexOf('DOCS_RH');
    const cFecha = t.encabezados.indexOf('FECHA_ENVIO');
    if (cId === -1 || cEst === -1 || cPdf === -1 || cRh === -1) return;
    // 27/oct (Agente 2): antes solo atendía filas con DOCS_RH lleno (RH subió un documento desde el Panel). Ahora atiende TAMBIÉN los
    // expedientes PENDIENTE o INCOMPLETO que se quedaron sin PDF (p. ej. porque generarPdfExpediente_ falló dentro de finalizarEnvio).
    //  - Se saltan los envíos de los últimos 3 minutos (finalizarEnvio todavía puede estar haciendo su propio PDF).
    //  - Primero los envíos más recientes. Los COMPLETADO sin PDF NO se tocan aquí: se hacen con el menú "Generar PDF de expedientes que faltan".
    //  - Si un PDF falla, se anota en la BITACORA del libro de accesos (evento PDF_ERROR) y no se reintenta ese ID por 1 hora
    //    (así un expediente con problema no se come el tiempo de los demás).
    const ahora = Date.now();
    const fechaEnvio = function (f) { return cFecha === -1 ? null : aFecha_(f[cFecha]); };
    const candidatas = t.filas.filter(function (f) {
      const est = estadoDe_(f[cEst]);
      if (!String(f[cId] || '').trim() || !est || est === 'CAPTURA' || String(f[cPdf] || '').trim()) return false;
      if (!(est === 'PENDIENTE' || est === 'INCOMPLETO' || String(f[cRh] || '').trim())) return false;
      const env = fechaEnvio(f);
      return !(env && ahora - env.getTime() < 180000);
    }).sort(function (a, b) {
      const fa = fechaEnvio(a), fb = fechaEnvio(b);
      return (fb ? fb.getTime() : 0) - (fa ? fa.getTime() : 0);
    });
    const ids = candidatas.map(function (f) { return limpiarId_(f[cId]); });
    for (let i = 0; i < ids.length; i++) {
      if (Date.now() - inicio > 240000) break;
      if (cache.get('pdf_fallo_' + ids[i])) continue;
      try { generarPdfExpediente_(ids[i]); } catch (e) {
        console.log('PDF automático ' + ids[i] + ': ' + e);
        cache.put('pdf_fallo_' + ids[i], '1', 3600);
        registrarErrorPdf_(ids[i], 'automático', e);
      }
    }
  } finally {
    cache.remove('pdf_auto_en_curso');
  }
}

/** 27/oct (Agente 2): deja visible (hoja BITACORA del libro de accesos, evento PDF_ERROR) que un PDF de expediente falló. Nunca lanza error. */
function registrarErrorPdf_(id, origen, err) {
  try {
    bitacora_(id, 'PDF_ERROR', origen + ': ' + String(err && err.message ? err.message : err).slice(0, 300), 'PORTAL');
  } catch (e) {}
}

/** Correr UNA vez desde el editor: crea la columna DOCS_RH y programa la revisión cada 5 minutos. */
function instalarPdfAutomatico() {
  verificarAccesoAdministrador_();
  obtenerHoja_(CONFIG.HOJA_EXPEDIENTES, ENC_EXPEDIENTES); // agrega DOCS_RH si falta
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pdfsPendientesAutomatico') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pdfsPendientesAutomatico').timeBased().everyMinutes(5).create();
  Logger.log('Listo: columna DOCS_RH creada y revisión de PDF cada 5 minutos activada.');
}


function simularLimpiezaPdfs() { limpiezaPdfs_(true); }
function limpiarPdfsViejos() { limpiezaPdfs_(false); }

/** Deja en cada expediente solo el PDF más reciente (el que está en CONTROL EXP; si no hay, el último creado). */
function limpiezaPdfs_(simular) {
  verificarAccesoAdministrador_();
  const inicio = Date.now();
  const hoja = obtenerHoja_(CONFIG.HOJA_EXPEDIENTES, ENC_EXPEDIENTES);
  const t = leerTabla_(hoja);
  const cId = t.encabezados.indexOf('ID_EMPLEADO'), cDep = t.encabezados.indexOf('DEPENDENCIA'), cPdf = t.encabezados.indexOf('PDF_EXPEDIENTE');
  const raiz = DriveApp.getFolderById(CONFIG.CARPETA_RAIZ_ID);
  let empleados = 0, sobran = 0;
  for (let i = 0; i < t.filas.length; i++) {
    if (Date.now() - inicio > 270000) { Logger.log('Se detuvo por tiempo: vuelve a correrla.'); break; }
    const id = limpiarId_(t.filas[i][cId]);
    if (!id) continue;
    const dep = String(t.filas[i][cDep] || '').trim() || 'SIN DEPENDENCIA';
    const itDep = raiz.getFoldersByName(dep); if (!itDep.hasNext()) continue;
    const itEmp = itDep.next().getFoldersByName(id); if (!itEmp.hasNext()) continue;
    const itPdf = itEmp.next().getFoldersByName(CARPETA_PDF_EXP); if (!itPdf.hasNext()) continue;
    const archivos = [];
    const it = itPdf.next().getFiles();
    while (it.hasNext()) { const f = it.next(); if (!f.isTrashed() && /_EXPEDIENTE_/.test(f.getName())) archivos.push(f); }
    if (archivos.length < 2) continue;
    const link = String(t.filas[i][cPdf] || '').trim();
    let conservar = archivos.filter(function (f) { return link && f.getUrl() === link; })[0];
    if (!conservar) conservar = archivos.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); })[0];
    empleados++;
    archivos.forEach(function (f) {
      if (f.getId() === conservar.getId()) return;
      sobran++;
      if (!simular) f.setTrashed(true);
    });
  }
  Logger.log((simular ? 'SIMULACRO: ' : 'LISTO: ') + sobran + ' PDF viejos de ' + empleados + ' empleados ' +
    (simular ? 'se mandarían' : 'se mandaron') + ' a la papelera.');
}
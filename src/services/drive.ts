// TODO: migrar a Supabase Storage quan el projecte passi a producció
import { google, type drive_v3 } from 'googleapis';
import { createReadStream } from 'node:fs';
import { basename, extname } from 'node:path';
import 'dotenv/config';

// ============================================================
//  Google Drive · pujada de factures amb estructura en català
//  Brulée Factures/{ANY}/{TRIMESTRE}/{MES ANY}/{proveidor}_{DDMMYYYY}.ext
//  Regla absoluta: MAI sobreescriure — sempre crear un fitxer nou.
// ============================================================

export const MESOS_CA = [
  'Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny',
  'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre',
];

/** Trimestre en català a partir del número de mes (1–12). */
export const getTrimestre = (mes: number): string => {
  if (mes <= 3) return '1r Trimestre';
  if (mes <= 6) return '2n Trimestre';
  if (mes <= 9) return '3r Trimestre';
  return '4t Trimestre';
};

/** minúscules · sense accents · no-alfanumèric → `_` · col·lapsa `_`. */
export const normalitzarNomFitxer = (nom: string): string =>
  nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // treu accents
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const MIME_PER_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// ---- Client Drive (lazy singleton) ------------------------------------

let _drive: drive_v3.Drive | null = null;

function getDrive(): drive_v3.Drive {
  if (_drive) return _drive;

  const { GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN } = process.env;
  if (!GDRIVE_CLIENT_ID || !GDRIVE_CLIENT_SECRET || !GDRIVE_REFRESH_TOKEN) {
    throw new Error('Falten credencials de Google Drive al .env (GDRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN).');
  }

  const oauth2 = new google.auth.OAuth2(GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: GDRIVE_REFRESH_TOKEN });

  _drive = google.drive({ version: 'v3', auth: oauth2 });
  return _drive;
}

/** Escapa cometes simples per a les queries de Drive. */
const q = (s: string): string => s.replace(/'/g, "\\'");

/**
 * Retorna l'ID d'una subcarpeta amb aquest nom dins de `parentId`,
 * creant-la si no existeix. (Les carpetes SÍ es reutilitzen.)
 */
async function assegurarCarpeta(nom: string, parentId: string): Promise<string> {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `name='${q(nom)}' and '${q(parentId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: 1,
  });

  const existent = res.data.files?.[0];
  if (existent?.id) return existent.id;

  const creada = await drive.files.create({
    requestBody: { name: nom, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id',
  });
  if (!creada.data.id) throw new Error(`No s'ha pogut crear la carpeta "${nom}" a Drive.`);
  return creada.data.id;
}

interface RutaCarpetes {
  carpetaId: string;
  drivePath: string;
}

/**
 * Assegura la ruta `Brulée Factures/{ANY}/{TRIMESTRE}/{MES ANY}` per a la data
 * indicada i retorna l'ID de la carpeta fulla + la ruta llegible.
 */
export async function assegurarRutaData(data: Date): Promise<RutaCarpetes> {
  const root = process.env.GDRIVE_FOLDER_ID;
  if (!root) throw new Error('Falta GDRIVE_FOLDER_ID al .env (carpeta arrel "Brulée Factures").');

  const any = String(data.getFullYear());
  const mes = data.getMonth() + 1;
  const trimestre = getTrimestre(mes);
  const mesAny = `${MESOS_CA[mes - 1]} ${any}`;

  const anyId = await assegurarCarpeta(any, root);
  const trimId = await assegurarCarpeta(trimestre, anyId);
  const mesId = await assegurarCarpeta(mesAny, trimId);

  return {
    carpetaId: mesId,
    drivePath: `Brulée Factures/${any}/${trimestre}/${mesAny}`,
  };
}

/**
 * Troba un nom de fitxer lliure dins de `carpetaId`. Si `nom` ja existeix,
 * afegeix `_2`, `_3`… abans de l'extensió. MAI sobreescriu.
 */
async function nomLliure(carpetaId: string, nom: string): Promise<string> {
  const drive = getDrive();
  const ext = extname(nom);
  const base = basename(nom, ext);

  let candidat = nom;
  let n = 1;
  // Cerca fins a trobar un nom que no existeixi.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await drive.files.list({
      q: `name='${q(candidat)}' and '${q(carpetaId)}' in parents and trashed=false`,
      fields: 'files(id)',
      spaces: 'drive',
      pageSize: 1,
    });
    if (!res.data.files || res.data.files.length === 0) return candidat;
    n += 1;
    candidat = `${base}_${n}${ext}`;
  }
}

export interface ResultatPujada {
  driveId: string;
  drivePath: string;
  nomFitxer: string;
}

/**
 * Puja una factura a Drive dins de la carpeta corresponent a `data`.
 * El nom es genera com `{proveidor normalitzat}_{DDMMYYYY}.ext` i es
 * garanteix únic (mai sobreescriu). Retorna l'ID i la ruta a Drive.
 */
export async function pujarFactura(
  fitxerLocal: string,
  proveidorNom: string,
  data: Date,
): Promise<ResultatPujada> {
  const drive = getDrive();
  const ext = extname(fitxerLocal).toLowerCase() || '.pdf';
  const mime = MIME_PER_EXT[ext] ?? 'application/octet-stream';

  const { carpetaId, drivePath } = await assegurarRutaData(data);

  const dd = String(data.getDate()).padStart(2, '0');
  const mm = String(data.getMonth() + 1).padStart(2, '0');
  const yyyy = String(data.getFullYear());
  const nomDesitjat = `${normalitzarNomFitxer(proveidorNom || 'desconegut')}_${dd}${mm}${yyyy}${ext}`;
  const nomFinal = await nomLliure(carpetaId, nomDesitjat);

  const creat = await drive.files.create({
    requestBody: { name: nomFinal, parents: [carpetaId] },
    media: { mimeType: mime, body: createReadStream(fitxerLocal) },
    fields: 'id',
  });

  if (!creat.data.id) throw new Error(`No s'ha pogut pujar "${nomFinal}" a Drive.`);

  return {
    driveId: creat.data.id,
    drivePath: `${drivePath}/${nomFinal}`,
    nomFitxer: nomFinal,
  };
}

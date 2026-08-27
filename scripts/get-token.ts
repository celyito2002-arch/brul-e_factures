/**
 * scripts/get-token.ts
 * Flux OAuth 2.0 de Gmail per obtenir un GMAIL_REFRESH_TOKEN.
 *
 * Ús:  npm run get-token
 *
 * 1) Llegeix GMAIL_CLIENT_ID i GMAIL_CLIENT_SECRET del .env
 * 2) Mostra la URL d'autorització de Google
 * 3) Espera que enganxis el codi (o la URL de redirecció sencera)
 * 4) Mostra el refresh_token per copiar al .env
 */
import { google } from 'googleapis';
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// Permisos necessaris: llegir correus + modificar etiquetes (treure UNREAD).
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

// El client OAuth ha de tenir aquesta URI de redirecció autoritzada.
// (Els clients de tipus "Desktop app" ja accepten http://localhost per defecte.)
const REDIRECT_URI = 'http://localhost';

/** Accepta tant el codi solt com la URL de redirecció completa (n'extreu ?code=). */
function extreureCodi(entrada: string): string {
  const net = entrada.trim();
  const match = net.match(/[?&]code=([^&\s]+)/);
  if (match) return decodeURIComponent(match[1]);
  return net;
}

async function main(): Promise<void> {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET } = process.env;

  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    console.error('✗ Falten GMAIL_CLIENT_ID i/o GMAIL_CLIENT_SECRET al .env.');
    console.error('  Copia .env.example a .env i omple aquestes dues claus abans de continuar.');
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline', // necessari per rebre un refresh_token
    prompt: 'consent', // força el consentiment perquè sempre retorni refresh_token
    scope: SCOPES,
  });

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(' 1) Obre aquesta URL al navegador i autoritza l\'accés a Gmail:\n');
  console.log('    ' + authUrl);
  console.log('\n 2) Després d\'autoritzar, el navegador redirigirà a http://localhost/?code=…');
  console.log('    (la pàgina no carregarà: és normal). Copia el valor de "code"');
  console.log('    de la barra d\'adreces — o enganxa la URL sencera aquí sota.');
  console.log('════════════════════════════════════════════════════════════════\n');

  const rl = createInterface({ input, output });
  const entrada = await rl.question('Enganxa el codi (o la URL de redirecció): ');
  rl.close();

  const codi = extreureCodi(entrada);
  if (!codi) {
    console.error('\n✗ No s\'ha rebut cap codi.');
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2.getToken(codi);

    if (!tokens.refresh_token) {
      console.error('\n⚠️  Google no ha retornat cap refresh_token.');
      console.error('   Sol passar si ja havies autoritzat abans. Revoca l\'accés a');
      console.error('   https://myaccount.google.com/permissions i torna a executar `npm run get-token`.');
      process.exit(1);
    }

    console.log('\n✅ Refresh token obtingut. Copia\'l al .env:\n');
    console.log('GMAIL_REFRESH_TOKEN=' + tokens.refresh_token + '\n');
  } catch (err) {
    console.error('\n✗ Error obtenint el token:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();

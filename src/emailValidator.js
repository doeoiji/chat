/**
 * Email validation ensuring addresses belong to legitimate, recognized email platforms
 * and strictly blocking disposable / temporary email services.
 */

const TEMP_EMAIL_DOMAINS = new Set([
  '10minutemail.com', '10minutemail.net', '10minutemail.org', '10minmail.com',
  '20minutemail.com', '33mail.com', 'anonbox.net', 'anonymbox.com',
  'binkmail.com', 'bobmail.info', 'burnermail.io', 'byom.de',
  'chammy.info', 'clrmail.com', 'crazymailing.com', 'deadaddress.com',
  'despam.it', 'discard.email', 'discardmail.com', 'discardmail.de',
  'disposable.email', 'disposableaddress.com', 'disposableemailaddresses.com',
  'disposableinbox.com', 'dispostable.com', 'dodgit.com', 'dropmail.me',
  'e4ward.com', 'emailondeck.com', 'emailtemporanea.com', 'emailtemporario.com.br',
  'fakeinbox.com', 'fakeinformation.com', 'fakemail.net', 'fakemailgenerator.com',
  'filzmail.com', 'fleckens.hu', 'getairmail.com', 'getnada.com',
  'grr.la', 'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de',
  'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com',
  'harakirimail.com', 'hidemail.de', 'imgof.com', 'inboxalias.com',
  'incognitomail.com', 'incognitomail.org', 'instant-mail.de', 'jetable.org',
  'kasmail.com', 'klassmaster.com', 'klzlk.com', 'koszmail.pl',
  'kurzepost.de', 'lawlita.com', 'lhsdv.com', 'lifebyfood.com',
  'lookugly.com', 'lopl.co.cc', 'lortemail.dk', 'mail-temporaire.fr',
  'mail.tm', 'mail.gw', 'mailcatch.com', 'maildrop.cc',
  'mailexpire.com', 'mailforspam.com', 'mailfreeonline.com', 'mailimate.com',
  'mailinator.com', 'mailinator.net', 'mailinator.org', 'mailinator2.com',
  'mailismagic.com', 'mailmetrash.com', 'mailmoat.com', 'mailnator.com',
  'mailnesia.com', 'mailnull.com', 'mailscrap.com', 'mailshell.com',
  'mailsiphon.com', 'mailslite.com', 'mailtemp.info', 'mailtothis.com',
  'mailzilla.com', 'mbx.cc', 'meltmail.com', 'mintemail.com',
  'moakt.com', 'mohmal.com', 'mt2014.com', 'mt2015.com',
  'my10minutemail.com', 'mytemp.email', 'mytrashmail.com', 'nada.email',
  'nada.ltd', 'neomailbox.com', 'nervmich.net', 'nervtmich.net',
  'netmails.net', 'neverbox.com', 'no-spam.ws', 'nobulk.com',
  'noclickemail.com', 'nogmailspam.info', 'nomail.xl.cx', 'nomail2me.com',
  'nospam.ze.tc', 'nospam4.us', 'nospamfor.us', 'nowmymail.com',
  'objectmail.com', 'obobbo.com', 'odaymail.com', 'oneoffemail.com',
  'onewaymail.com', 'oopi.org', 'ordinaryamerican.net', 'otherinbox.com',
  'ourklips.com', 'outlawspam.com', 'ovpn.to', 'owlpic.com',
  'pancakemail.com', 'pimpedupmyspace.com', 'pjjkp.com', 'plexolan.de',
  'pokemail.net', 'politikerclub.de', 'poofy.org', 'pookmail.com',
  'privacy.net', 'proxymail.eu', 'prtnx.com', 'putthisinyourspamdatabase.com',
  'quickinbox.com', 'rcpt.at', 'recode.me', 'recursor.net',
  'regbypass.com', 'rmqkr.net', 'rppkn.com', 'rtrtr.com',
  'safe-mail.net', 'safetymail.info', 'safetypost.de', 'sandelf.de',
  'saynotospams.com', 'selfdestructingmail.com', 'sendspamhere.com', 'sharklasers.com',
  'shieldedmail.com', 'shiftmail.com', 'shitmail.me', 'shortmail.net',
  'sibmail.com', 'skeefmail.com', 'slaskpost.se', 'slopsbox.com',
  'smellfear.com', 'snakemail.com', 'sneakemail.com', 'snkmail.com',
  'sofimail.com', 'sofort-mail.de', 'sogetthis.com', 'soodonims.com',
  'spam.la', 'spam.su', 'spam4.me', 'spamavert.com',
  'spambob.net', 'spambob.org', 'spambog.com', 'spambog.de',
  'spambog.ru', 'spambox.info', 'spambox.us', 'spamcannon.com',
  'spamcannon.net', 'spamcon.org', 'spamcorptastic.com', 'spamcowboy.com',
  'spamcowboy.net', 'spamcowboy.org', 'spamday.com', 'spamex.com',
  'spamfree24.com', 'spamfree24.de', 'spamfree24.eu', 'spamfree24.info',
  'spamfree24.net', 'spamfree24.org', 'spamgourmet.com', 'spamherelots.com',
  'spamhereplease.com', 'spamhole.com', 'spamify.com', 'spaminator.de',
  'spamkill.info', 'spaml.com', 'spaml.de', 'spammotel.com',
  'spamobox.com', 'spamoff.de', 'spamslicer.com', 'spamspot.com',
  'spamthis.co.uk', 'spamthisplease.com', 'spamtrail.com', 'supergreatmail.com',
  'supermailer.jp', 'suremail.info', 'teewars.org', 'teleworm.com',
  'teleworm.us', 'temp-mail.com', 'temp-mail.de', 'temp-mail.io',
  'temp-mail.org', 'temp-mail.ru', 'tempail.com', 'tempalias.com',
  'tempe-mail.com', 'tempemail.biz', 'tempemail.co.za', 'tempemail.com',
  'tempemail.net', 'tempinbox.co.uk', 'tempinbox.com', 'tempmail.co',
  'tempmail.de', 'tempmail.eu', 'tempmail.it', 'tempmail.net',
  'tempmail.org', 'tempmail.us', 'tempmail2.com', 'tempmaildemo.com',
  'tempmailer.com', 'tempmailer.de', 'tempomail.fr', 'temporarily.de',
  'temporarioemail.com.br', 'temporaryemail.net', 'temporaryemail.us', 'temporaryforwarding.com',
  'temporaryinbox.com', 'temporarymailaddress.com', 'tempr.email', 'thanksnospam.info',
  'thankyou2010.com', 'thisisnotmyrealemail.com', 'throwawayemailaddress.com', 'throwawaymail.com',
  'tilien.com', 'tmail.ws', 'tmailinator.com', 'tradermail.info',
  'trash-amil.com', 'trash-mail.at', 'trash-mail.com', 'trash-mail.de',
  'trash2009.com', 'trashemail.de', 'trashmail.at', 'trashmail.com',
  'trashmail.de', 'trashmail.me', 'trashmail.net', 'trashmail.org',
  'trashmail.ws', 'trashmailer.com', 'trashymail.com', 'trashymail.net',
  'trbvm.com', 'turual.com', 'twinmail.de', 'tyldd.com',
  'uggsrock.com', 'upliftnow.com', 'uplipht.com', 'venompen.com',
  'veryrealemail.com', 'viditag.com', 'viewcastmedia.com', 'viewcastmedia.net',
  'viewcastmedia.org', 'webm4il.info', 'wegwerfadresse.de', 'wegwerfemail.com',
  'wegwerfemail.de', 'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org',
  'wetrainbayarea.com', 'wetrainbayarea.org', 'wh4f.org', 'whyspam.me',
  'willselfdestruct.com', 'winemaven.info', 'wronghead.com', 'wuzup.net',
  'wuzupmail.net', 'wwwnew.eu', 'xagloo.com', 'xemaps.com',
  'xents.com', 'xmaily.com', 'xoxy.net', 'yep.it',
  'yogamaven.com', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'yuurok.com', 'zehnminuten.de', 'zehnminutenmail.de', 'zippymail.info',
  'zoaxe.com', 'zoemail.org', 'internxt.com', 'guerrillamail.org'
]);

const TEMP_KEYWORD_PATTERNS = [
  /(^|\.)temp-?mail/,
  /(^|\.)10min(ute)?mail/,
  /(^|\.)throwaway/,
  /(^|\.)trash-?mail/,
  /(^|\.)fake-?mail/,
  /(^|\.)burner-?mail/,
  /(^|\.)disposable/,
  /(^|\.)guerrilla/,
  /(^|\.)mailinator/,
  /(^|\.)yopmail/,
  /(^|\.)spambox/,
  /(^|\.)getnada/,
  /(^|\.)mohmal/
];

// Recognized legitimate email platforms
const VALID_EMAIL_PLATFORMS = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'outlook.co.uk', 'outlook.de', 'outlook.fr', 'outlook.jp', 'outlook.in',
  'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.es', 'hotmail.it',
  // Yahoo
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.ca', 'yahoo.com.au',
  'yahoo.de', 'yahoo.fr', 'yahoo.es', 'yahoo.it', 'yahoo.co.jp',
  'ymail.com', 'rocketmail.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // Proton
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
  // Zoho
  'zoho.com', 'zohomail.com', 'zohomail.in', 'zohomail.eu',
  // Fastmail, Tuta, GMX, AOL, Mail.com, Hey, Duck
  'fastmail.com', 'fastmail.fm', 'tuta.com', 'tuta.io', 'tutanota.com',
  'tutamail.com', 'keemail.me', 'aol.com', 'aim.com', 'gmx.com', 'gmx.de',
  'gmx.net', 'mail.com', 'hey.com', 'duck.com',
  // Regional & ISP valid platforms
  'yandex.com', 'yandex.ru', 'ya.ru',
  'mail.ru', 'inbox.ru', 'bk.ru', 'list.ru',
  'web.de', 't-online.de', 'posteo.de', 'mailbox.org',
  'naver.com', 'daum.net', 'hanmail.net', 'kakao.com',
  'qq.com', '163.com', '126.com', 'sina.com',
  'rediffmail.com', 'seznam.cz', 'wp.pl', 'o2.pl', 'interia.pl',
  'libero.it', 'virgilio.it', 'orange.fr', 'free.fr', 'laposte.net',
  'btinternet.com', 'sky.com', 'virginmedia.com', 'shaw.ca', 'rogers.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net'
]);

const EMAIL_SYNTAX_REGEX = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function isAcademicDomain(domain) {
  return /\.(edu|edu\.[a-z]{2}|ac\.[a-z]{2})$/.test(domain);
}

function isTempMailDomain(domain) {
  if (TEMP_EMAIL_DOMAINS.has(domain)) return true;
  // Also catch subdomains of known temp mail providers (e.g. sub.mailinator.com)
  for (const blocked of TEMP_EMAIL_DOMAINS) {
    if (domain.endsWith(`.${blocked}`)) return true;
  }
  return TEMP_KEYWORD_PATTERNS.some((rx) => rx.test(domain));
}

function validateEmail(rawEmail) {
  if (typeof rawEmail !== 'string') {
    return { valid: false, normalized: '', reason: 'Email is required.' };
  }

  const normalized = rawEmail.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !EMAIL_SYNTAX_REGEX.test(normalized)) {
    return { valid: false, normalized, reason: 'Please enter a valid email address.' };
  }

  const [localPart, domain] = normalized.split('@');
  if (!localPart || localPart.length > 64 || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return { valid: false, normalized, reason: 'Please enter a valid email address.' };
  }

  if (isTempMailDomain(domain)) {
    return {
      valid: false,
      normalized,
      reason: 'Temporary or disposable email addresses are not allowed. Please use a valid email platform like Gmail, Outlook, Yahoo, iCloud, or Proton.'
    };
  }

  if (!VALID_EMAIL_PLATFORMS.has(domain) && !isAcademicDomain(domain)) {
    return {
      valid: false,
      normalized,
      reason: 'Please use an email from a recognized valid platform (e.g., Gmail, Outlook, Yahoo, iCloud, Proton, Zoho, Fastmail, or an academic .edu domain).'
    };
  }

  return { valid: true, normalized };
}

module.exports = {
  validateEmail,
  isTempMailDomain,
  VALID_EMAIL_PLATFORMS,
  TEMP_EMAIL_DOMAINS
};

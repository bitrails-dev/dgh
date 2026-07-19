// Local ambient declaration for `nodemailer` (used by the SMTP notification transport).
// nodemailer ships without bundled type declarations in this repo, and @types/nodemailer is not a
// dependency we can add from this lane (package manifests are integration-owner-owned). The transport
// casts the imported module to its own narrow interface, so `any` here is sufficient and scoped.
declare module 'nodemailer'

import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
      /**
       * Query string ya validado y coercionado por `validate.middleware`.
       * En Express 5 `req.query` es de solo lectura, por eso el resultado
       * se expone acá. Los controllers lo castean al tipo inferido del schema.
       */
      validatedQuery?: unknown;
      /**
       * Membresía del grupo de la ruta (`:groupId`), cargada por
       * `requireGroupMember`. Permite a los controllers/services usar el rol
       * sin volver a consultar la base.
       */
      membership?: {
        id: string;
        groupId: string;
        userId: string;
        role: 'admin' | 'member';
      };
    }
  }
}

export {};

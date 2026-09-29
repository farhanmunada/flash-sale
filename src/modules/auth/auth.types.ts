/** Auth module types and DTOs. */

export interface UserRow {
  readonly id: number;
  readonly email: string;
  readonly password_hash: string;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface PublicUser {
  readonly user_id: number;
  readonly email: string;
}

export interface LoginResult {
  readonly token: string;
  readonly expires_in: number;
}

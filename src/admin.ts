import { client } from './Client'

import * as dotenvexpand from 'dotenv-expand';
import * as dotenv from 'dotenv';

dotenvexpand.expand(dotenv.config());

export const admin = client.users.fetch(process.env.ADMIN_USER_ID ?? '');
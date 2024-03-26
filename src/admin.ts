import { client } from './Client.js'

import * as dotenvexpand from 'dotenv-expand';
import * as dotenv from 'dotenv';

dotenvexpand.expand(dotenv.config());

export const getAdmin = (async () => await client.users.fetch(process.env.ADMIN_USER_ID ?? ''));
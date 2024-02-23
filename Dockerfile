FROM node:21

RUN apt-get update -y && apt-get upgrade -y

WORKDIR /bot

COPY package.json .
COPY tsconfig.json .

RUN yarn

CMD yarn exec prisma generate; yarn exec prisma db push; yarn run dev
FROM node:21

RUN apt-get update -y && apt-get upgrade -y
RUN apt-get install -y pandoc texlive-latex-base texlive-latex-extra lmodern

WORKDIR /bot

COPY package.json .
COPY tsconfig.json .
COPY deploy.cjs .

RUN yarn

CMD yarn exec prisma generate; yarn exec prisma db push; yarn run dev

RUN mkdir tmp
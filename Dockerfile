FROM node:21

RUN apt-get update -y && apt-get upgrade -y

WORKDIR /bot

COPY package.json .

RUN yarn install
export const requiredDescription =
  "На учебной площадке не включается светильник после нажатия выключателя";

export const fullFormValues = {
  description: requiredDescription,
  location: "Учебная зона, второй уровень",
  consequences: "В вечернее время проход остаётся недостаточно освещённым",
  desiredActions: "Проверить светильник и восстановить штатное освещение",
};

const unbrokenText = "ДлиннаяНепробельнаяПоследовательностьДляПроверкиПереноса";

export const controlledServerErrorMessage = `Сервис временно не завершил обработку синтетического запроса. ${unbrokenText.repeat(3)}`;

export const longGenerationResult = {
  title: `${unbrokenText.repeat(2)}`.slice(0, 110),
  body: [
    "На учебной площадке не включается светильник после нажатия выключателя.",
    "В вечернее время проход остаётся недостаточно освещённым.",
    unbrokenText.repeat(8),
    "Прошу:",
    "1. Проверить светильник и восстановить штатное освещение.",
    "2. Сообщить о результате проверки через доступный канал связи.",
  ].join("\n\n"),
  warnings: [
    "Проверьте синтетическое описание перед использованием результата.",
    unbrokenText.repeat(3).slice(0, 180),
  ],
};

export const expectedCopiedText = `${longGenerationResult.title}\n\n${longGenerationResult.body}`;
